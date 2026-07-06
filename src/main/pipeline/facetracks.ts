/**
 * Face tracking across frames: turns sparse per-frame detections into
 * per-person tracks with an interpolated, smoothed box for every analysis
 * frame. The active-speaker model scores each track as a whole, so identity
 * continuity matters more here than in the old per-frame focus heuristic —
 * a track that flickers between two people would blend their mouths and
 * poison the speech score.
 */

import { iou, type FaceBox } from './speaker'

export interface FaceTrack {
  /** First analysis-frame index covered by this track (inclusive). */
  start: number
  /** One smoothed box per frame from `start`; length = track duration. */
  boxes: FaceBox[]
}

/** Minimum IOU between a detection and a track's last box to match. */
const MATCH_IOU = 0.25
/** Detections may drop out briefly (blur, profile turn); bridge gaps up to this. */
const MAX_GAP_SEC = 0.6
/** Discard tracks shorter than this — too little context for a speech score. */
const MIN_TRACK_SEC = 0.4
const MIN_DETECTIONS = 3
/** Median smoothing window for box centre/size, in seconds. */
const SMOOTH_SEC = 0.5

interface Detection {
  frame: number
  box: FaceBox
}

/** Shrinking-window median filter (no zero-padding artefacts at the edges). */
export function medianFilter(values: number[], window: number): number[] {
  const half = Math.floor(window / 2)
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1))
    const sorted = [...slice].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  })
}

function lerpBox(a: FaceBox, b: FaceBox, t: number): FaceBox {
  const mix = (x: number, y: number): number => x + (y - x) * t
  return {
    x1: mix(a.x1, b.x1),
    y1: mix(a.y1, b.y1),
    x2: mix(a.x2, b.x2),
    y2: mix(a.y2, b.y2),
    score: mix(a.score, b.score)
  }
}

/** Fill every frame between detections by linear interpolation, then smooth. */
function finalizeTrack(detections: Detection[], smoothWindow: number): FaceTrack {
  const start = detections[0].frame
  const end = detections[detections.length - 1].frame
  const boxes: FaceBox[] = new Array(end - start + 1)
  let d = 0
  for (let f = start; f <= end; f++) {
    while (d < detections.length - 1 && detections[d + 1].frame <= f) d++
    const cur = detections[d]
    if (cur.frame === f || d === detections.length - 1) {
      boxes[f - start] = { ...cur.box }
    } else {
      const next = detections[d + 1]
      const t = (f - cur.frame) / (next.frame - cur.frame)
      boxes[f - start] = lerpBox(cur.box, next.box, t)
    }
  }

  // Smooth centre and size independently (the crop fed to the ASD model is a
  // square around the centre, so jitter here becomes jitter in its input).
  const cx = medianFilter(boxes.map((b) => (b.x1 + b.x2) / 2), smoothWindow)
  const cy = medianFilter(boxes.map((b) => (b.y1 + b.y2) / 2), smoothWindow)
  const w = medianFilter(boxes.map((b) => b.x2 - b.x1), smoothWindow)
  const h = medianFilter(boxes.map((b) => b.y2 - b.y1), smoothWindow)
  const smoothed = boxes.map((b, i) => ({
    x1: cx[i] - w[i] / 2,
    y1: cy[i] - h[i] / 2,
    x2: cx[i] + w[i] / 2,
    y2: cy[i] + h[i] / 2,
    score: b.score
  }))
  return { start, boxes: smoothed }
}

/**
 * Build per-person face tracks from detections. `facesPerFrame[f]` is the
 * detections for frame `f`, or null when that frame was skipped (detection
 * runs on a stride; boxes for skipped frames are interpolated). Tracks never
 * span scene cuts.
 */
export function buildFaceTracks(
  facesPerFrame: Array<FaceBox[] | null>,
  sceneCuts: number[],
  fps: number
): FaceTrack[] {
  const cutSet = new Set(sceneCuts)
  const maxGap = Math.max(1, Math.round(MAX_GAP_SEC * fps))
  const minLen = Math.max(2, Math.round(MIN_TRACK_SEC * fps))
  const smoothWindow = Math.max(3, Math.round(SMOOTH_SEC * fps)) | 1

  const done: Detection[][] = []
  let active: Detection[][] = []

  const finish = (track: Detection[]): void => {
    const span = track[track.length - 1].frame - track[0].frame + 1
    if (track.length >= MIN_DETECTIONS && span >= minLen) done.push(track)
  }

  for (let f = 0; f < facesPerFrame.length; f++) {
    if (cutSet.has(f)) {
      active.forEach(finish)
      active = []
    }
    // Expire tracks whose last detection is too old to bridge.
    active = active.filter((track) => {
      if (f - track[track.length - 1].frame > maxGap) {
        finish(track)
        return false
      }
      return true
    })

    const faces = facesPerFrame[f]
    if (!faces) continue
    const used = new Set<Detection[]>()
    for (const box of faces) {
      let best: Detection[] | null = null
      let bestIou = MATCH_IOU
      for (const track of active) {
        if (used.has(track)) continue
        const v = iou(track[track.length - 1].box, box)
        if (v > bestIou) {
          best = track
          bestIou = v
        }
      }
      if (best) {
        used.add(best)
        best.push({ frame: f, box })
      } else {
        const fresh: Detection[] = [{ frame: f, box }]
        active.push(fresh)
        used.add(fresh)
      }
    }
  }
  active.forEach(finish)

  return done.map((track) => finalizeTrack(track, smoothWindow))
}
