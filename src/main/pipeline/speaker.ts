/**
 * Speaker-aware focus selection. On multi-person footage the crop should
 * follow whoever is talking, not whoever is biggest in frame. UltraFace only
 * gives boxes, so speech is inferred visually: a talking face's mouth region
 * changes constantly between samples while a listener's stays still. Faces
 * are tracked across frames by IOU, each track carries an exponential moving
 * average of mouth activity, and the focus switches speaker only when a rival
 * clearly out-talks the current one for a sustained run (hysteresis), which
 * reads like a deliberate camera switch rather than jitter.
 */

export interface FaceBox {
  x1: number
  y1: number
  x2: number
  y2: number
  score: number
}

export function iou(a: FaceBox, b: FaceBox): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  const inter = ix * iy
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / Math.max(1e-9, areaA + areaB - inter)
}

/**
 * Mean absolute RGB difference between two frames over the mouth region
 * (lower third) of a face box. Frames are raw rgb24 buffers of w×h pixels;
 * box coordinates are normalised 0..1.
 */
export function mouthActivity(
  prev: Buffer,
  cur: Buffer,
  box: FaceBox,
  w: number,
  h: number
): number {
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(max, v))
  const px1 = clamp(Math.floor(box.x1 * w), w - 1)
  const px2 = clamp(Math.ceil(box.x2 * w), w)
  const py1 = clamp(Math.floor((box.y1 + (box.y2 - box.y1) * 0.62) * h), h - 1)
  const py2 = clamp(Math.ceil(box.y2 * h), h)
  let sum = 0
  let count = 0
  for (let y = py1; y < py2; y += 1) {
    const row = y * w * 3
    for (let x = px1; x < px2; x += 2) {
      const i = row + x * 3
      sum += Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1])
      count += 2
    }
  }
  return count === 0 ? 0 : sum / count
}

const TRACK_MATCH_IOU = 0.25
const ACTIVITY_EMA_ALPHA = 0.4
/** A rival must out-talk the current speaker by this factor… */
const SPEAKER_SWITCH_RATIO = 1.5
/** …for this many consecutive frames before focus switches (1s at 2 fps). */
const SPEAKER_SWITCH_FRAMES = 2
/** Ignore rivals whose absolute activity is below this (near-static faces). */
const MIN_SWITCH_ACTIVITY = 1.0
/** Keep a briefly undetected track alive for this many frames. */
const TRACK_MAX_MISSED = 2

interface Track {
  box: FaceBox
  centre: number
  ema: number
  missed: number
}

export interface FocusSelection {
  /** Per-frame horizontal focus centre (0..1), or null when no face. */
  centres: Array<number | null>
  /** Frames where the speaker changed — treated like camera cuts downstream. */
  switchCuts: number[]
}

function weight(t: Track): number {
  const area = (t.box.x2 - t.box.x1) * (t.box.y2 - t.box.y1)
  return area * t.box.score
}

/**
 * Choose the per-frame focus centre from detected faces and their mouth
 * activity. Pure and exported for unit tests.
 */
export function chooseFocusCentres(
  facesPerFrame: FaceBox[][],
  activityPerFrame: number[][],
  sceneCuts: number[]
): FocusSelection {
  const cutSet = new Set(sceneCuts)
  let tracks: Track[] = []
  let speaker: Track | null = null
  let challenger: Track | null = null
  let challengerStreak = 0
  const centres: Array<number | null> = []
  const switchCuts: number[] = []

  const reset = (): void => {
    tracks = []
    speaker = null
    challenger = null
    challengerStreak = 0
  }

  for (let f = 0; f < facesPerFrame.length; f++) {
    if (cutSet.has(f)) reset()

    // Greedy IOU matching of this frame's faces onto existing tracks.
    const updated: Track[] = []
    const used = new Set<Track>()
    facesPerFrame[f].forEach((box, i) => {
      let best: Track | null = null
      let bestIou = TRACK_MATCH_IOU
      for (const t of tracks) {
        if (used.has(t)) continue
        const v = iou(t.box, box)
        if (v > bestIou) {
          best = t
          bestIou = v
        }
      }
      const activity = activityPerFrame[f]?.[i] ?? 0
      const centre = (box.x1 + box.x2) / 2
      if (best) {
        used.add(best)
        best.box = box
        best.centre = centre
        best.ema = best.ema * (1 - ACTIVITY_EMA_ALPHA) + activity * ACTIVITY_EMA_ALPHA
        best.missed = 0
        updated.push(best)
      } else {
        updated.push({ box, centre, ema: activity * ACTIVITY_EMA_ALPHA, missed: 0 })
      }
    })
    // A single dropped detection must not lose the speaker: age tracks briefly.
    for (const t of tracks) {
      if (!used.has(t) && t.missed < TRACK_MAX_MISSED) {
        t.missed++
        t.ema *= 0.7
        updated.push(t)
      }
    }
    tracks = updated

    if (tracks.length === 0) {
      centres.push(null)
      continue
    }

    if (!speaker || !tracks.includes(speaker)) {
      // (Re)acquire: most active track, size-weighted on a tie/at rest.
      speaker = tracks.reduce((a, b) => (b.ema + weight(b) > a.ema + weight(a) ? b : a))
      challenger = null
      challengerStreak = 0
    } else {
      const rivals = tracks.filter((t) => t !== speaker && t.missed === 0)
      const rival =
        rivals.length > 0 ? rivals.reduce((a, b) => (b.ema > a.ema ? b : a)) : null
      if (
        rival &&
        rival.ema > MIN_SWITCH_ACTIVITY &&
        rival.ema > speaker.ema * SPEAKER_SWITCH_RATIO
      ) {
        if (challenger === rival) challengerStreak++
        else {
          challenger = rival
          challengerStreak = 1
        }
        if (challengerStreak >= SPEAKER_SWITCH_FRAMES) {
          speaker = rival
          switchCuts.push(f)
          challenger = null
          challengerStreak = 0
        }
      } else {
        challenger = null
        challengerStreak = 0
      }
    }

    centres.push(speaker.centre)
  }

  return { centres, switchCuts }
}
