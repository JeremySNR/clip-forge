import type { FocusKeyframe } from './types'
import { focusAt } from './focusTrack'

/**
 * Offline virtual-camera planning for the auto-reframe crop.
 *
 * Analysis knows the whole shot in advance, so the crop does not have to
 * react. Within each shot (between camera cuts and speaker switches) the
 * planner keeps the face centre inside a tolerance band around the crop
 * centre and otherwise holds perfectly still, like a locked-off camera:
 *
 * 1. Split the shot greedily into the fewest holds whose face positions fit
 *    one crop position (the band is `FACE_BAND` of the crop width either side).
 * 2. Keep the previous position when it still fits the next hold; otherwise
 *    re-centre on that hold.
 * 3. Reach each new position with an eased pan centred on the change, so the
 *    face does not leave the band while the camera catches up.
 *
 * This is the stationary/pan mode split of Google's AutoFlip, with lookahead
 * instead of a reactive threshold. Positions are face centres in source
 * coordinates, clamped to where the narrowest (9:16) crop can actually go.
 */

/** 9:16 crop of a 16:9 source, as a share of the source width. */
export const PORTRAIT_CROP_WIDTH = (9 / 16) / (16 / 9)
/** The face centre may sit this share of the crop width either side of centre. */
export const FACE_BAND = 0.2
/** Median window removing detection jitter before planning. */
const SMOOTH_SEC = 0.8
/** Shorter holds join their neighbour with a wider band instead of an extra pan. */
const MIN_HOLD_SEC = 1.2
/** Pan speed in crop widths per second, bounded below and above in duration. */
const PAN_SPEED = 0.9
const PAN_MIN_SEC = 0.5
const PAN_MAX_SEC = 1.4
/** Moves smaller than this share of the crop width are not worth a pan. */
const MIN_MOVE = 0.04

export function portraitCropWidth(sourceAspect: number): number {
  return Math.min(1, (9 / 16) / Math.max(0.1, sourceAspect))
}

function median(values: number[], window: number): number[] {
  const half = Math.floor(window / 2)
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), i + half + 1).sort((a, b) => a - b)
    return slice[Math.floor(slice.length / 2)]
  })
}

interface Hold { start: number; end: number; lo: number; hi: number }

/** Greedy maximal holds: each frame range whose positions fit within `2 * band`. */
function holds(values: number[], band: number): Hold[] {
  const out: Hold[] = []
  let start = 0, lo = values[0], hi = values[0]
  for (let i = 1; i < values.length; i++) {
    const nextLo = Math.min(lo, values[i]), nextHi = Math.max(hi, values[i])
    if (nextHi - nextLo > 2 * band) {
      out.push({ start, end: i, lo, hi })
      start = i; lo = hi = values[i]
    } else { lo = nextLo; hi = nextHi }
  }
  out.push({ start, end: values.length, lo, hi })
  return out
}

/**
 * Absorb holds too brief to justify their own pan into a neighbour, allowing
 * the face briefly outside the band, but never so far that a steady drift
 * collapses into one badly framed hold.
 */
function mergeBrief(list: Hold[], minFrames: number, maxRange: number): Hold[] {
  const out: Hold[] = []
  for (const hold of list) {
    const previous = out[out.length - 1]
    const brief = previous && (hold.end - hold.start < minFrames || previous.end - previous.start < minFrames)
    if (brief && Math.max(previous.hi, hold.hi) - Math.min(previous.lo, hold.lo) <= maxRange) {
      previous.end = hold.end
      previous.lo = Math.min(previous.lo, hold.lo)
      previous.hi = Math.max(previous.hi, hold.hi)
    } else out.push({ ...hold })
  }
  return out
}

/** Plan one shot's keyframes from per-frame face centres (no nulls). */
export function planShot(
  centres: number[], startSec: number, fps: number, cropWidth = PORTRAIT_CROP_WIDTH, faceBand = FACE_BAND
): FocusKeyframe[] {
  if (centres.length === 0) return []
  const edge = cropWidth / 2
  const clamped = centres.map(x => Math.min(1 - edge, Math.max(edge, x)))
  const smooth = median(clamped, Math.max(1, Math.round(SMOOTH_SEC * fps)) | 1)
  const band = faceBand * cropWidth
  const plan = mergeBrief(holds(smooth, band), Math.round(MIN_HOLD_SEC * fps), 3 * band)
  // Where a hold can be framed from: the band around every position, or, for
  // a hold widened by a brief excursion, close to where the face mostly was.
  const feasible = (hold: Hold): [number, number] => {
    if (hold.hi - hold.lo <= 2 * band) return [hold.hi - band, hold.lo + band]
    const sorted = smooth.slice(hold.start, hold.end).sort((a, b) => a - b)
    const middle = sorted[Math.floor(sorted.length / 2)]
    return [middle - band / 2, middle + band / 2]
  }
  const centre = (hold: Hold): number => { const [lo, hi] = feasible(hold); return (lo + hi) / 2 }
  const keyframes: FocusKeyframe[] = []
  let x = centre(plan[0])
  keyframes.push({ t: startSec, x, cut: true })
  let busyUntil = startSec
  for (let k = 1; k < plan.length; k++) {
    const hold = plan[k]
    const [lo, hi] = feasible(hold)
    // Keep still while the current position still frames this hold.
    if (x >= lo && x <= hi) continue
    const target = centre(hold)
    if (Math.abs(target - x) < MIN_MOVE * cropWidth) continue
    const pan = Math.min(PAN_MAX_SEC, Math.max(PAN_MIN_SEC, Math.abs(target - x) / cropWidth / PAN_SPEED))
    const change = startSec + hold.start / fps
    const t = Math.max(busyUntil, change - pan / 2)
    keyframes.push({ t, x: target, cut: false, pan })
    busyUntil = t + pan
    x = target
  }
  return keyframes
}

export interface FramingMetrics {
  /** Share of sampled time the followed face sits beyond a quarter crop width from centre. */
  offCentreShare: number
  /** 95th percentile face offset from the crop centre, in crop widths. */
  offCentreP95: number
  /** Within-shot camera moves per minute (cuts excluded). */
  movesPerMinute: number
  /** Share of time the crop is moving. */
  movingShare: number
}

/**
 * Framing quality of a focus track against the face it should follow.
 * `targets[i]` is the followed face centre at frame i (null: none).
 */
export function framingMetrics(
  targets: Array<number | null>, track: FocusKeyframe[], startSec: number, fps: number,
  cropWidth = PORTRAIT_CROP_WIDTH
): FramingMetrics {
  const edge = cropWidth / 2
  const offsets: number[] = []
  let moving = 0, samples = 0, previous: number | null = null
  for (let i = 0; i < targets.length; i++) {
    const t = startSec + i / fps
    const centre = Math.min(1 - edge, Math.max(edge, focusAt(track, t)))
    if (previous !== null && Math.abs(centre - previous) > 1e-4 &&
        !track.some(k => k.cut && Math.abs(k.t - t) < 1.5 / fps)) moving++
    previous = centre
    samples++
    const face = targets[i]
    if (face !== null) offsets.push(Math.abs(Math.min(1 - edge, Math.max(edge, face)) - centre) / cropWidth)
  }
  offsets.sort((a, b) => a - b)
  const minutes = Math.max(1e-6, targets.length / fps / 60)
  return {
    offCentreShare: offsets.filter(o => o > 0.25).length / Math.max(1, offsets.length),
    offCentreP95: offsets[Math.floor(0.95 * (offsets.length - 1))] ?? 0,
    movesPerMinute: track.filter((k, i) => i > 0 && !k.cut && Math.abs(k.x - track[i - 1].x) > 1e-3).length / minutes,
    movingShare: moving / Math.max(1, samples)
  }
}
