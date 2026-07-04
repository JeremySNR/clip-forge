import { describe, expect, it } from 'vitest'
import { focusAt } from '@shared/focusTrack'
import { buildFocusTrack } from '../src/main/pipeline/faces'

describe('focusAt', () => {
  const track = [
    { t: 10, x: 0.2 },
    { t: 14, x: 0.8 }
  ]

  it('returns the last keyframe at or before t (piecewise constant)', () => {
    expect(focusAt(track, 9)).toBe(0.2) // before the first keyframe
    expect(focusAt(track, 10)).toBe(0.2)
    expect(focusAt(track, 13.9)).toBe(0.2)
    expect(focusAt(track, 14)).toBe(0.8)
    expect(focusAt(track, 99)).toBe(0.8)
  })

  it('defaults to centre for an empty track', () => {
    expect(focusAt([], 5)).toBe(0.5)
  })
})

describe('buildFocusTrack', () => {
  it('returns null when too few faces were detected', () => {
    const centres = [0.5, null, null, null, null, null, null, null, null, null]
    expect(buildFocusTrack(centres, 0)).toBeNull()
  })

  it('produces a single keyframe for a stable speaker', () => {
    const centres = Array.from({ length: 20 }, () => 0.4)
    const track = buildFocusTrack(centres, 10)
    expect(track).not.toBeNull()
    expect(track!.length).toBe(1)
    expect(track![0].t).toBe(10)
    expect(track![0].x).toBeCloseTo(0.4)
  })

  it('cuts to a new position when the speaker moves persistently', () => {
    const centres = [
      ...Array.from({ length: 10 }, () => 0.25),
      ...Array.from({ length: 10 }, () => 0.75)
    ]
    const track = buildFocusTrack(centres, 0)
    expect(track).not.toBeNull()
    expect(track!.length).toBe(2)
    expect(track![0].x).toBeCloseTo(0.25)
    expect(track![1].x).toBeCloseTo(0.75)
  })

  it('starts a fresh run at a detected camera cut', () => {
    const centres = [
      ...Array.from({ length: 8 }, () => 0.3),
      ...Array.from({ length: 8 }, () => 0.7)
    ]
    const track = buildFocusTrack(centres, 0, [8])
    expect(track).not.toBeNull()
    expect(track!.length).toBe(2)
    // The cut refocuses exactly at the shot change (frame 8 at 2 fps = 4s).
    expect(track![1].t).toBe(4)
  })
})
