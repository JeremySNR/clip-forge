import { describe, expect, it } from 'vitest'
import { chooseFocusCentres, iou, mouthActivity, type FaceBox } from '../src/main/pipeline/speaker'

/** A face box around a horizontal centre (normalised coordinates). */
function face(cx: number, score = 0.9, size = 0.2): FaceBox {
  return { x1: cx - size / 2, y1: 0.3, x2: cx + size / 2, y2: 0.3 + size * 1.3, score }
}

const LEFT = 0.25
const RIGHT = 0.75

/** Two faces on screen with given mouth activities, over `n` frames. */
function twoSpeakerFrames(
  n: number,
  leftActivity: number,
  rightActivity: number
): { faces: FaceBox[][]; activity: number[][] } {
  return {
    faces: Array.from({ length: n }, () => [face(LEFT), face(RIGHT)]),
    activity: Array.from({ length: n }, () => [leftActivity, rightActivity])
  }
}

describe('chooseFocusCentres', () => {
  it('follows the only face', () => {
    const faces = Array.from({ length: 6 }, () => [face(0.4)])
    const activity = faces.map(() => [0])
    const { centres, switchCuts } = chooseFocusCentres(faces, activity, [])
    expect(centres.every((c) => c !== null && Math.abs(c - 0.4) < 1e-9)).toBe(true)
    expect(switchCuts).toEqual([])
  })

  it('returns null centres when no face is visible', () => {
    const { centres } = chooseFocusCentres([[], [], []], [[], [], []], [])
    expect(centres).toEqual([null, null, null])
  })

  it('focuses the talking face, not the bigger silent one', () => {
    const n = 8
    const faces = Array.from({ length: n }, () => [
      face(LEFT, 0.95, 0.3), // big, silent
      face(RIGHT, 0.9, 0.15) // small, talking
    ])
    const activity = Array.from({ length: n }, () => [0.2, 8])
    const { centres } = chooseFocusCentres(faces, activity, [])
    // After the EMA warms up, focus must sit on the talking face.
    expect(centres[n - 1]).toBeCloseTo(RIGHT)
  })

  it('switches speaker with hysteresis and reports a switch cut', () => {
    const a = twoSpeakerFrames(6, 8, 0.2) // left talks
    const b = twoSpeakerFrames(8, 0.2, 8) // then right talks
    const faces = [...a.faces, ...b.faces]
    const activity = [...a.activity, ...b.activity]
    const { centres, switchCuts } = chooseFocusCentres(faces, activity, [])

    expect(centres[5]).toBeCloseTo(LEFT)
    expect(centres[centres.length - 1]).toBeCloseTo(RIGHT)
    // Exactly one deliberate switch, not a flip on the first louder frame.
    expect(switchCuts.length).toBe(1)
    expect(switchCuts[0]).toBeGreaterThan(6)
  })

  it('does not switch for a single noisy frame', () => {
    const quiet = twoSpeakerFrames(6, 8, 0.2)
    const blip = twoSpeakerFrames(1, 0.2, 20) // one-frame spike on the right
    const rest = twoSpeakerFrames(5, 8, 0.2)
    const faces = [...quiet.faces, ...blip.faces, ...rest.faces]
    const activity = [...quiet.activity, ...blip.activity, ...rest.activity]
    const { centres, switchCuts } = chooseFocusCentres(faces, activity, [])
    expect(switchCuts).toEqual([])
    expect(centres[centres.length - 1]).toBeCloseTo(LEFT)
  })

  it('survives a briefly dropped detection of the speaker', () => {
    const talking = twoSpeakerFrames(6, 8, 0.2)
    // One frame where the left (speaking) face is not detected at all.
    const dropped: { faces: FaceBox[][]; activity: number[][] } = {
      faces: [[face(RIGHT)]],
      activity: [[0.2]]
    }
    const after = twoSpeakerFrames(4, 8, 0.2)
    const faces = [...talking.faces, ...dropped.faces, ...after.faces]
    const activity = [...talking.activity, ...dropped.activity, ...after.activity]
    const { centres, switchCuts } = chooseFocusCentres(faces, activity, [])
    expect(switchCuts).toEqual([])
    expect(centres[centres.length - 1]).toBeCloseTo(LEFT)
  })

  it('resets tracking at scene cuts', () => {
    const a = twoSpeakerFrames(4, 8, 0.2)
    const b = { faces: Array.from({ length: 4 }, () => [face(0.6)]), activity: Array.from({ length: 4 }, () => [0]) }
    const faces = [...a.faces, ...b.faces]
    const activity = [...a.activity, ...b.activity]
    const { centres } = chooseFocusCentres(faces, activity, [4])
    expect(centres[3]).toBeCloseTo(LEFT)
    expect(centres[4]).toBeCloseTo(0.6)
  })
})

describe('iou', () => {
  it('is 1 for identical boxes and 0 for disjoint boxes', () => {
    const a = face(0.3)
    expect(iou(a, a)).toBeCloseTo(1)
    expect(iou(face(0.2, 0.9, 0.1), face(0.8, 0.9, 0.1))).toBe(0)
  })
})

describe('mouthActivity', () => {
  const W = 8
  const H = 8
  const flat = (v: number): Buffer => Buffer.alloc(W * H * 3, v)
  const box = face(0.5, 0.9, 0.6)

  it('is zero for identical frames', () => {
    expect(mouthActivity(flat(100), flat(100), box, W, H)).toBe(0)
  })

  it('ignores uniform whole-face motion (head bob / lighting)', () => {
    // The mouth and upper face move together, so the differential cancels:
    // a nodding or gesturing listener must not read as talking.
    expect(mouthActivity(flat(100), flat(140), box, W, H)).toBe(0)
  })

  it('reports motion concentrated in the mouth region', () => {
    // Only the lower (mouth) rows change; the upper face is still → speech.
    const prev = flat(100)
    const cur = Buffer.from(prev)
    for (let y = 6; y < 8; y++) {
      for (let x = 0; x < W * 3; x++) cur[y * W * 3 + x] = 140
    }
    expect(mouthActivity(prev, cur, box, W, H)).toBeCloseTo(40, 0)
  })
})
