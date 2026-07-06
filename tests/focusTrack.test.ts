import { describe, expect, it } from 'vitest'
import { FOCUS_PAN_SEC, focusAt } from '@shared/focusTrack'
import { buildFocusTrack } from '../src/main/pipeline/faces'

describe('focusAt', () => {
  const track = [
    { t: 10, x: 0.2 },
    { t: 14, x: 0.8 }
  ]

  it('snaps instantly on large shifts (speaker switches)', () => {
    expect(focusAt(track, 9)).toBe(0.2) // before the first keyframe
    expect(focusAt(track, 10)).toBe(0.2)
    expect(focusAt(track, 13.9)).toBe(0.2)
    expect(focusAt(track, 14)).toBe(0.8)
    expect(focusAt(track, 99)).toBe(0.8)
  })

  it('pans smoothly to small within-shot shifts instead of stepping', () => {
    const moving = [
      { t: 10, x: 0.5, cut: true },
      { t: 14, x: 0.62 }
    ]
    // Starts at the old position, eases towards the new one, settles there.
    expect(focusAt(moving, 14)).toBeCloseTo(0.5)
    const mid = focusAt(moving, 14 + FOCUS_PAN_SEC / 2)
    expect(mid).toBeGreaterThan(0.5)
    expect(mid).toBeLessThan(0.62)
    expect(focusAt(moving, 14 + FOCUS_PAN_SEC)).toBeCloseTo(0.62)
    expect(focusAt(moving, 99)).toBeCloseTo(0.62)
  })

  it('snaps on keyframes flagged as cuts even for small shifts', () => {
    const cutTrack = [
      { t: 10, x: 0.5, cut: true },
      { t: 14, x: 0.62, cut: true }
    ]
    expect(focusAt(cutTrack, 14)).toBe(0.62)
    expect(focusAt(cutTrack, 14.1)).toBe(0.62)
  })

  it('completes a pan before the next keyframe takes over', () => {
    const dense = [
      { t: 10, x: 0.5, cut: true },
      { t: 14, x: 0.6 },
      { t: 14.3, x: 0.7 }
    ]
    // The 14s pan is capped at 0.3s, so 14.3 starts exactly from 0.6.
    expect(focusAt(dense, 14.299)).toBeCloseTo(0.6, 2)
    expect(focusAt(dense, 14.3)).toBeCloseTo(0.6)
    expect(focusAt(dense, 14.3 + FOCUS_PAN_SEC)).toBeCloseTo(0.7)
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

  it('flags run-start keyframes as cuts and within-shot moves as pans', () => {
    const centres = [
      ...Array.from({ length: 8 }, () => 0.3),
      ...Array.from({ length: 8 }, () => 0.45), // same shot, person moved
      ...Array.from({ length: 8 }, () => 0.8) // camera cut
    ]
    const track = buildFocusTrack(centres, 0, [16])
    expect(track).not.toBeNull()
    expect(track!.length).toBe(3)
    expect(track![0].cut).toBe(true) // clip start
    expect(track![1].cut).toBe(false) // person moved within the shot
    expect(track![2].cut).toBe(true) // camera cut
  })
})
