import { describe, expect, it } from 'vitest'
import { chooseSpeakerByScores, type SpeakerCandidate } from '../src/main/pipeline/speaker'
import { buildFaceTracks } from '../src/main/pipeline/facetracks'
import type { FaceBox } from '../src/main/pipeline/speaker'

const FPS = 25

/** A full-length track at a fixed position with the given per-frame scores. */
function track(centre: number, scores: number[], area = 0.04, start = 0): SpeakerCandidate {
  return {
    start,
    centres: scores.map(() => centre),
    areas: scores.map(() => area),
    scores
  }
}

const LEFT = 0.25
const RIGHT = 0.75

describe('chooseSpeakerByScores', () => {
  it('focuses the speaking face, not the bigger silent one', () => {
    const n = 2 * FPS
    const silentBig = track(LEFT, Array(n).fill(-1.5), 0.1)
    const talkingSmall = track(RIGHT, Array(n).fill(1.5), 0.03)
    const { centres } = chooseSpeakerByScores([silentBig, talkingSmall], n, [], FPS)
    expect(centres[n - 1]).toBeCloseTo(RIGHT)
  })

  it('does not leave the speaker for a silent face, no matter its size', () => {
    // The exact failure mode this rework fixes: someone moving or touching
    // their face must not steal focus while another person is speaking.
    const n = 4 * FPS
    const speaker = track(LEFT, Array(n).fill(1.2))
    const mover = track(RIGHT, Array(n).fill(-0.8), 0.2)
    const { centres, switchCuts } = chooseSpeakerByScores([speaker, mover], n, [], FPS)
    expect(switchCuts).toEqual([])
    expect(centres.every((c) => c !== null && Math.abs(c - LEFT) < 1e-9)).toBe(true)
  })

  it('switches when the other person starts speaking, with hysteresis', () => {
    const n = 4 * FPS
    const half = n / 2
    const a = track(LEFT, [...Array(half).fill(1.5), ...Array(half).fill(-1.5)])
    const b = track(RIGHT, [...Array(half).fill(-1.5), ...Array(half).fill(1.5)])
    const { centres, switchCuts } = chooseSpeakerByScores([a, b], n, [], FPS)
    expect(centres[half - 1]).toBeCloseTo(LEFT)
    expect(centres[n - 1]).toBeCloseTo(RIGHT)
    expect(switchCuts.length).toBe(1)
    // Not instant (debounced), not slower than ~a second.
    expect(switchCuts[0]).toBeGreaterThan(half)
    expect(switchCuts[0]).toBeLessThan(half + FPS)
  })

  it('ignores a brief speaking blip from the other person', () => {
    const n = 4 * FPS
    const a = track(LEFT, Array(n).fill(1.0))
    const bScores = Array(n).fill(-1.0)
    for (let i = 50; i < 53; i++) bScores[i] = 2.5 // 0.12 s blip
    const b = track(RIGHT, bScores)
    const { centres, switchCuts } = chooseSpeakerByScores([a, b], n, [], FPS)
    expect(switchCuts).toEqual([])
    expect(centres[n - 1]).toBeCloseTo(LEFT)
  })

  it('holds position while nobody speaks', () => {
    const n = 3 * FPS
    const third = FPS
    const a = track(LEFT, [...Array(third).fill(1.5), ...Array(2 * third).fill(-1.5)])
    const b = track(RIGHT, Array(n).fill(-1.5))
    const { centres, switchCuts } = chooseSpeakerByScores([a, b], n, [], FPS)
    expect(switchCuts).toEqual([])
    expect(centres[n - 1]).toBeCloseTo(LEFT)
  })

  it('yields the cold-start biggest face quickly once someone speaks', () => {
    const n = 2 * FPS
    const bigSilent = track(LEFT, Array(n).fill(-1.5), 0.15)
    const speaker = track(
      RIGHT,
      [...Array(10).fill(-1.5), ...Array(n - 10).fill(1.5)],
      0.03
    )
    const { centres, switchCuts } = chooseSpeakerByScores([bigSilent, speaker], n, [], FPS)
    expect(centres[0]).toBeCloseTo(LEFT) // cold start: biggest face
    expect(switchCuts.length).toBe(1)
    expect(switchCuts[0]).toBeLessThan(10 + FPS * 0.3) // fast surrender
    expect(centres[n - 1]).toBeCloseTo(RIGHT)
  })

  it('does not ping-pong when both people talk over each other', () => {
    const n = 6 * FPS
    // Alternate slightly higher scores every 10 frames while both speak.
    const aScores = Array.from({ length: n }, (_, i) => (Math.floor(i / 10) % 2 === 0 ? 1.4 : 1.0))
    const bScores = Array.from({ length: n }, (_, i) => (Math.floor(i / 10) % 2 === 1 ? 1.4 : 1.0))
    const { switchCuts } = chooseSpeakerByScores(
      [track(LEFT, aScores), track(RIGHT, bScores)],
      n,
      [],
      FPS
    )
    expect(switchCuts).toEqual([])
  })

  it('resets at scene cuts and reacquires the new speaker immediately', () => {
    const n = 2 * FPS
    const cut = FPS
    const a = track(LEFT, Array(cut).fill(1.5)) // only exists in shot 1
    const b: SpeakerCandidate = {
      start: cut,
      centres: Array(n - cut).fill(0.6),
      areas: Array(n - cut).fill(0.05),
      scores: Array(n - cut).fill(1.5)
    }
    const { centres } = chooseSpeakerByScores([a, b], n, [cut], FPS)
    expect(centres[cut - 1]).toBeCloseTo(LEFT)
    expect(centres[cut]).toBeCloseTo(0.6)
  })

  it('survives the speaker track dropping briefly', () => {
    const n = 3 * FPS
    const gapStart = FPS
    const gapLen = 5
    const a1 = track(LEFT, Array(gapStart).fill(1.5))
    const a2: SpeakerCandidate = {
      start: gapStart + gapLen,
      centres: Array(n - gapStart - gapLen).fill(LEFT),
      areas: Array(n - gapStart - gapLen).fill(0.04),
      scores: Array(n - gapStart - gapLen).fill(1.5)
    }
    const distractor = track(RIGHT, Array(n).fill(-1.5), 0.1)
    const { centres } = chooseSpeakerByScores([a1, a2, distractor], n, [], FPS)
    // During the gap focus stays near the speaker's last position...
    expect(centres[gapStart + 2]).toBeCloseTo(RIGHT, 0)
    // ...well, the nearest surviving track — and it must return to the
    // speaker as soon as their track resumes.
    expect(centres[n - 1]).toBeCloseTo(LEFT)
  })

  it('returns nulls when no faces are present', () => {
    const { centres } = chooseSpeakerByScores([], 5, [], FPS)
    expect(centres).toEqual([null, null, null, null, null])
  })
})

describe('buildFaceTracks', () => {
  const box = (cx: number, size = 0.2): FaceBox => ({
    x1: cx - size / 2,
    y1: 0.3,
    x2: cx + size / 2,
    y2: 0.3 + size,
    score: 0.9
  })

  it('links strided detections into one track with interpolated boxes', () => {
    const n = 30
    const frames: Array<FaceBox[] | null> = Array.from({ length: n }, (_, f) =>
      f % 2 === 0 ? [box(0.3 + f * 0.002)] : null
    )
    const tracks = buildFaceTracks(frames, [], FPS)
    expect(tracks.length).toBe(1)
    expect(tracks[0].start).toBe(0)
    expect(tracks[0].boxes.length).toBe(29) // last detection at frame 28
    // Interpolated odd frames sit between their neighbours.
    const c = (b: FaceBox): number => (b.x1 + b.x2) / 2
    expect(c(tracks[0].boxes[15])).toBeGreaterThan(c(tracks[0].boxes[13]))
  })

  it('keeps two people as two separate tracks', () => {
    const n = 30
    const frames: Array<FaceBox[] | null> = Array.from({ length: n }, (_, f) =>
      f % 2 === 0 ? [box(0.25), box(0.75)] : null
    )
    const tracks = buildFaceTracks(frames, [], FPS)
    expect(tracks.length).toBe(2)
    const centres = tracks.map((t) => (t.boxes[0].x1 + t.boxes[0].x2) / 2).sort((a, b) => a - b)
    expect(centres[0]).toBeCloseTo(0.25)
    expect(centres[1]).toBeCloseTo(0.75)
  })

  it('bridges short detection gaps but not scene cuts', () => {
    const n = 60
    const cut = 30
    const frames: Array<FaceBox[] | null> = Array.from({ length: n }, (_, f) => {
      if (f >= 24 && f < 28) return [] // missed detections (gap < MAX_GAP_SEC)
      return [box(f < cut ? 0.3 : 0.7)]
    })
    const withGap = buildFaceTracks(frames, [], FPS)
    // Without a cut the gap is bridged (position jump alone doesn't split
    // because IOU matching fails -> new track). Position jump = new person.
    expect(withGap.length).toBe(2)
    const split = buildFaceTracks(frames, [cut], FPS)
    expect(split.length).toBe(2)
    expect(split[0].start + split[0].boxes.length).toBeLessThanOrEqual(cut)
    expect(split[1].start).toBeGreaterThanOrEqual(cut)
  })

  it('drops blink-and-miss tracks', () => {
    const n = 50
    const frames: Array<FaceBox[] | null> = Array.from({ length: n }, (_, f) => {
      const faces = [box(0.3)]
      if (f >= 20 && f < 23) faces.push(box(0.8, 0.1)) // 3-frame false positive
      return faces
    })
    const tracks = buildFaceTracks(frames, [], FPS)
    expect(tracks.length).toBe(1)
  })
})
