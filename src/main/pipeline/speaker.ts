/**
 * Speaker-aware focus selection. On multi-person footage the crop should
 * follow whoever is talking, not whoever is biggest in frame.
 *
 * The primary signal is the LR-ASD audio-visual model (see asd.ts): every
 * face track carries a per-frame speaking logit, and `chooseSpeakerByScores`
 * turns those into focus centres with hysteresis so cuts read like deliberate
 * camera switches.
 *
 * When the ASD models are unavailable, the legacy visual heuristic remains:
 * a talking face's mouth region changes between samples while a listener's
 * stays still (`mouthActivity` + `chooseFocusCentres`).
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
 * Mean absolute RGB difference between two frames over a horizontal band of a
 * face box (band fractions measured from the top of the box downward). Frames
 * are raw rgb24 buffers of w×h pixels; box coordinates are normalised 0..1.
 */
function regionMotion(
  prev: Buffer,
  cur: Buffer,
  box: FaceBox,
  w: number,
  h: number,
  fromFrac: number,
  toFrac: number
): number {
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(max, v))
  const boxH = box.y2 - box.y1
  const px1 = clamp(Math.floor(box.x1 * w), w - 1)
  const px2 = clamp(Math.ceil(box.x2 * w), w)
  const py1 = clamp(Math.floor((box.y1 + boxH * fromFrac) * h), h - 1)
  const py2 = clamp(Math.ceil((box.y1 + boxH * toFrac) * h), h)
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

/**
 * Visual speech signal for one face: how much the mouth region (lower ~38% of
 * the box) moves *relative to* the upper face (eyes/brow). Subtracting the
 * upper-face motion cancels whole-head movement — a nodding or gesturing
 * listener moves both regions equally and scores ~0, while a talking mouth
 * moves far more than the brow. This is what keeps the crop on the person
 * actually speaking rather than whoever happens to be moving.
 */
export function mouthActivity(
  prev: Buffer,
  cur: Buffer,
  box: FaceBox,
  w: number,
  h: number
): number {
  const mouth = regionMotion(prev, cur, box, w, h, 0.62, 1)
  const upper = regionMotion(prev, cur, box, w, h, 0.05, 0.45)
  return Math.max(0, mouth - upper)
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
/**
 * After a switch, hold the new speaker for at least this many frames before
 * switching again. Stops the focus ping-ponging between two people who trade
 * off quickly — each cut then reads as a deliberate camera switch.
 */
const SWITCH_COOLDOWN_FRAMES = 3

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
  let cooldown = 0
  /** Last committed speaker centre, for continuity when a track is lost. */
  let lastCentre: number | null = null
  const centres: Array<number | null> = []
  const switchCuts: number[] = []

  const reset = (): void => {
    tracks = []
    speaker = null
    challenger = null
    challengerStreak = 0
    cooldown = 0
    lastCentre = null
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

    if (cooldown > 0) cooldown--

    if (!speaker || !tracks.includes(speaker)) {
      // (Re)acquire. When we had a speaker (lastCentre known) but lost the
      // track to detection jitter, prefer the track closest to where the
      // speaker just was — continuity over jumping to the biggest face. On a
      // cold start pick the most active, size-weighted at rest.
      if (lastCentre !== null) {
        speaker = tracks.reduce((a, b) =>
          Math.abs(b.centre - lastCentre!) < Math.abs(a.centre - lastCentre!) ? b : a
        )
      } else {
        speaker = tracks.reduce((a, b) => (b.ema + weight(b) > a.ema + weight(a) ? b : a))
      }
      challenger = null
      challengerStreak = 0
    } else {
      const rivals = tracks.filter((t) => t !== speaker && t.missed === 0)
      const rival =
        rivals.length > 0 ? rivals.reduce((a, b) => (b.ema > a.ema ? b : a)) : null
      if (
        cooldown === 0 &&
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
          cooldown = SWITCH_COOLDOWN_FRAMES
        }
      } else {
        challenger = null
        challengerStreak = 0
      }
    }

    lastCentre = speaker.centre
    centres.push(speaker.centre)
  }

  return { centres, switchCuts }
}

// ---------------------------------------------------------------------------
// Score-based selection (LR-ASD active speaker detection)
// ---------------------------------------------------------------------------

/** A face track with per-frame active-speaker logits (> 0 means speaking). */
export interface SpeakerCandidate {
  /** First analysis-frame index covered by the track. */
  start: number
  /** Horizontal face centre (0..1) per frame from `start`. */
  centres: number[]
  /** Normalised face box area per frame from `start`. */
  areas: number[]
  /** Active-speaker logit per frame from `start`. */
  scores: number[]
}

/** Logit above which a face counts as actively speaking. */
const SPEAK_ON = 0
/** A speaking rival must persist this long before focus cuts to them. */
const SWITCH_SEC = 0.4
/**
 * When the current speaker is *also* speaking, a rival must beat their score
 * by this margin — two people talking over each other must not ping-pong.
 */
const OVERLAP_MARGIN = 1.0
/** Minimum gap between deliberate switches away from a confirmed speaker. */
const COOLDOWN_SEC = 1.0
/**
 * Focus held by someone who has not spoken yet (cold start on the biggest
 * face) yields to an actual speaker after only this long.
 */
const UNCONFIRMED_SWITCH_SEC = 0.12

/**
 * Choose per-frame focus centres from active-speaker scores.
 *
 * Rules, in order of intent:
 *  - the focus sits on the person the model says is speaking;
 *  - it never leaves them for someone who merely moves — a switch requires
 *    the rival to be *speaking* (score above SPEAK_ON) for a sustained run;
 *  - when nobody speaks, the focus holds its position instead of wandering;
 *  - on a cold start (nobody has spoken yet) the biggest face holds focus,
 *    but surrenders it quickly the moment anyone actually speaks.
 */
export function chooseSpeakerByScores(
  tracks: SpeakerCandidate[],
  frameCount: number,
  sceneCuts: number[],
  fps: number
): FocusSelection {
  const switchFrames = Math.max(1, Math.round(SWITCH_SEC * fps))
  const fastFrames = Math.max(1, Math.round(UNCONFIRMED_SWITCH_SEC * fps))
  const cooldownFrames = Math.max(1, Math.round(COOLDOWN_SEC * fps))
  const cutSet = new Set(sceneCuts)

  // Per-frame candidate lists (indices into `tracks`).
  const perFrame: number[][] = Array.from({ length: frameCount }, () => [])
  tracks.forEach((track, i) => {
    const end = Math.min(frameCount, track.start + track.centres.length)
    for (let f = Math.max(0, track.start); f < end; f++) perFrame[f].push(i)
  })

  const at = (i: number, f: number): { centre: number; area: number; score: number } => {
    const track = tracks[i]
    const k = f - track.start
    return { centre: track.centres[k], area: track.areas[k], score: track.scores[k] }
  }

  const centres: Array<number | null> = []
  const switchCuts: number[] = []
  let current = -1
  /** Has the current focus target actually spoken while focused? */
  let confirmed = false
  let challenger = -1
  let challengerStreak = 0
  let cooldown = 0
  let lastCentre: number | null = null

  const reset = (): void => {
    current = -1
    confirmed = false
    challenger = -1
    challengerStreak = 0
    cooldown = 0
    lastCentre = null
  }

  for (let f = 0; f < frameCount; f++) {
    if (cutSet.has(f)) reset()
    const candidates = perFrame[f]
    if (candidates.length === 0) {
      centres.push(null)
      continue
    }
    if (cooldown > 0) cooldown--

    if (current === -1 || !candidates.includes(current)) {
      // (Re)acquire focus: prefer whoever is speaking; otherwise stay near
      // where the speaker just was (track lost to detection jitter); on a
      // true cold start take the biggest face until someone speaks.
      const speaking = candidates.filter((i) => at(i, f).score > SPEAK_ON)
      if (speaking.length > 0) {
        current = speaking.reduce((a, b) => (at(b, f).score > at(a, f).score ? b : a))
        confirmed = true
      } else if (lastCentre !== null) {
        const anchor = lastCentre
        current = candidates.reduce((a, b) =>
          Math.abs(at(b, f).centre - anchor) < Math.abs(at(a, f).centre - anchor) ? b : a
        )
        // keep previous `confirmed` — continuity of the same person
      } else {
        current = candidates.reduce((a, b) => (at(b, f).area > at(a, f).area ? b : a))
        confirmed = false
      }
      challenger = -1
      challengerStreak = 0
    } else {
      const cur = at(current, f)
      if (cur.score > SPEAK_ON) confirmed = true

      const currentSpeaking = cur.score > SPEAK_ON
      const bar = currentSpeaking ? cur.score + OVERLAP_MARGIN : SPEAK_ON
      let rival = -1
      let rivalScore = bar
      for (const i of candidates) {
        if (i === current) continue
        const s = at(i, f).score
        if (s > rivalScore) {
          rival = i
          rivalScore = s
        }
      }

      const gated = confirmed && cooldown > 0
      if (rival !== -1 && !gated) {
        if (challenger === rival) challengerStreak++
        else {
          challenger = rival
          challengerStreak = 1
        }
        if (challengerStreak >= (confirmed ? switchFrames : fastFrames)) {
          current = rival
          confirmed = true
          switchCuts.push(f)
          challenger = -1
          challengerStreak = 0
          cooldown = cooldownFrames
        }
      } else {
        challenger = -1
        challengerStreak = 0
      }
    }

    lastCentre = at(current, f).centre
    centres.push(lastCentre)
  }

  return { centres, switchCuts }
}
