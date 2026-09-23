import type { Composition, ContentRegion } from '@shared/types'
import { speakerComposition } from '@shared/composition'
import type { FaceBox } from './speaker'
import type { ScoredFaceTrack } from './asd'

/**
 * Two-person split screen for quick exchanges in a shared wide shot.
 *
 * Cutting a 9:16 crop between two people who trade short turns reads as a
 * frantic camera; stacking both, as podcast clipping tools do, keeps both
 * visible. A range becomes a split when, within one camera shot, the same
 * two faces are visible throughout and both speak within a short window.
 * Long single-speaker passages keep the ordinary speaker-following crop.
 */

export interface SpeakerSplit { start: number; end: number; composition: Composition }

/** Each person needs this much speech within ±EXCHANGE_WINDOW_SEC to count as an exchange. */
const EXCHANGE_WINDOW_SEC = 2.5
const EXCHANGE_SPEECH_SEC = 0.6
/** Splits shorter than this flicker; gaps shorter than this between splits are bridged. */
const MIN_SPLIT_SEC = 3
const BRIDGE_SEC = 1.5
/** A face needs this share of a split's frames. */
const MIN_PRESENCE = 0.9
/** Source crop height as a multiple of face height (face ~1/3 of its panel). */
const FACE_TO_PANEL = 3
/** Face centre sits this far down the panel, leaving headroom. */
const FACE_CENTRE_Y = 0.42
/** Output panel is 1080 x 960; never enlarge the source more than this. */
const PANEL_ASPECT = 1080 / 960
const PANEL_HEIGHT_PX = 960
/** Preferred and absolute enlargement limits for a panel. */
const MAX_UPSCALE = 2.5
const HARD_MAX_UPSCALE = 3.2

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * A panel-shaped source rectangle around a face, clamped inside the frame.
 * `maxWidth` keeps a neighbour out of the panel; the panel is skipped when
 * that would enlarge the source too far.
 */
export function speakerPanelSource(
  box: FaceBox, source: { width: number; height: number }, maxWidth = 1
): ContentRegion | undefined {
  const faceHeight = box.y2 - box.y1
  const heightFor = (width: number): number => width / (PANEL_ASPECT * source.height / source.width)
  // Enough source pixels that the panel is not a soft blow-up, unless that
  // would take in the other person.
  let height = Math.min(Math.max(faceHeight * FACE_TO_PANEL, PANEL_HEIGHT_PX / MAX_UPSCALE / source.height), heightFor(maxWidth))
  if (height < faceHeight * 1.8 || PANEL_HEIGHT_PX / (height * source.height) > HARD_MAX_UPSCALE) return undefined
  let width = height * PANEL_ASPECT * source.height / source.width
  if (width > 1) { height /= width; width = 1 }
  if (height > 1) return undefined
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2
  const x = Math.min(1 - width, Math.max(0, cx - width / 2))
  const y = Math.min(1 - height, Math.max(0, cy - FACE_CENTRE_Y * height))
  return { x, y, width, height }
}

function boxAt(track: ScoredFaceTrack, frame: number): FaceBox | undefined {
  const i = frame - track.start
  return i >= 0 && i < (track.boxes?.length ?? 0) ? track.boxes![i] : undefined
}

function speaking(track: ScoredFaceTrack, frame: number): boolean {
  const i = frame - track.start
  return i >= 0 && i < track.scores.length && track.scores[i] > 0
}

/** Ranges (frame indices) where both tracks speak within the exchange window. */
function exchangeRanges(a: ScoredFaceTrack, b: ScoredFaceTrack, from: number, to: number, fps: number): Array<[number, number]> {
  const reach = Math.round(EXCHANGE_WINDOW_SEC * fps)
  const need = EXCHANGE_SPEECH_SEC * fps
  const prefix = (track: ScoredFaceTrack): number[] => {
    const sums = [0]
    for (let f = from; f < to; f++) sums.push(sums[sums.length - 1] + (speaking(track, f) ? 1 : 0))
    return sums
  }
  const pa = prefix(a), pb = prefix(b)
  const ranges: Array<[number, number]> = []
  let open = -1
  for (let f = from; f <= to; f++) {
    const lo = Math.max(from, f - reach) - from, hi = Math.min(to, f + reach) - from
    const active = f < to && pa[hi] - pa[lo] >= need && pb[hi] - pb[lo] >= need
    if (active && open < 0) open = f
    if (!active && open >= 0) { ranges.push([open, f]); open = -1 }
  }
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] - last[1] <= BRIDGE_SEC * fps) last[1] = range[1]
    else merged.push([...range])
  }
  return merged.filter(([s, e]) => e - s >= MIN_SPLIT_SEC * fps)
}

/**
 * Split-screen ranges for one clip, in source seconds. `sceneCuts` are frame
 * indices; splits never span a cut. `source` is the decoded frame size.
 */
export function planSpeakerSplits(
  tracks: ScoredFaceTrack[], frameCount: number, sceneCuts: number[], fps: number,
  clipStartSec: number, source: { width: number; height: number }
): SpeakerSplit[] {
  const bounds = [0, ...sceneCuts.filter(c => c > 0 && c < frameCount), frameCount]
  const splits: SpeakerSplit[] = []
  for (let s = 0; s < bounds.length - 1; s++) {
    const from = bounds[s], to = bounds[s + 1]
    if (to - from < MIN_SPLIT_SEC * fps) continue
    // The two people who speak most in this shot.
    const talkers = tracks.filter(t => t.boxes && t.start < to && t.start + t.scores.length > from)
      .map(t => ({ t, talk: t.scores.filter((v, i) => v > 0 && t.start + i >= from && t.start + i < to).length }))
      .sort((x, y) => y.talk - x.talk).slice(0, 2)
    if (talkers.length < 2 || talkers[1].talk < EXCHANGE_SPEECH_SEC * fps) continue
    const [a, b] = talkers.map(x => x.t)
    for (const [start, end] of exchangeRanges(a, b, from, to, fps)) {
      const boxes = [a, b].map(track => {
        const present: FaceBox[] = []
        for (let f = start; f < end; f++) { const box = boxAt(track, f); if (box) present.push(box) }
        return present
      })
      if (boxes.some(list => list.length < MIN_PRESENCE * (end - start))) continue
      const typical = boxes.map(list => ({ x1: median(list.map(b => b.x1)), y1: median(list.map(b => b.y1)),
        x2: median(list.map(b => b.x2)), y2: median(list.map(b => b.y2)), score: 1 }))
      // Left person on top, matching reading order.
      typical.sort((p, q) => (p.x1 + p.x2) - (q.x1 + q.x2))
      // Each panel stops short of the other face so nobody appears twice.
      const centre = (b: FaceBox): number => (b.x1 + b.x2) / 2
      const gap = centre(typical[1]) - centre(typical[0])
      const [top, bottom] = typical.map((box, i) =>
        speakerPanelSource(box, source, 2 * (gap - (typical[1 - i].x2 - typical[1 - i].x1) / 2)))
      const composition = top && bottom && speakerComposition(top, bottom)
      if (composition) splits.push({ start: clipStartSec + start / fps, end: clipStartSec + end / fps, composition })
    }
  }
  return splits
}
