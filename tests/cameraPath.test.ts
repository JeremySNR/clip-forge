import { describe, expect, it } from 'vitest'
import { FACE_BAND, PORTRAIT_CROP_WIDTH, framingMetrics, planShot, portraitCropWidth } from '@shared/cameraPath'
import { focusAt } from '@shared/focusTrack'

const FPS = 25
const band = FACE_BAND * PORTRAIT_CROP_WIDTH
const frames = (seconds: number, x: (t: number) => number): number[] =>
  Array.from({ length: Math.round(seconds * FPS) }, (_, i) => x(i / FPS))

describe('planShot', () => {
  it('holds perfectly still while a swaying face stays within the band', () => {
    const sway = frames(20, t => 0.5 + 0.8 * band * Math.sin(t * 2))
    const track = planShot(sway, 10, FPS)
    expect(track).toEqual([{ t: 10, x: expect.closeTo(0.5, 2), cut: true }])
  })

  it('pans once, ahead of a lasting move, and keeps the face framed throughout', () => {
    const centres = frames(12, t => (t < 6 ? 0.4 : 0.6))
    const track = planShot(centres, 0, FPS)
    expect(track).toHaveLength(2)
    expect(track[1].pan).toBeGreaterThan(0)
    // The pan is centred on the move, so it starts before the face leaves.
    expect(track[1].t).toBeLessThan(6)
    expect(track[1].t + track[1].pan!).toBeGreaterThan(6)
    expect(focusAt(track, 11)).toBeCloseTo(0.6, 2)
  })

  it('ignores a brief lean instead of panning out and back', () => {
    const lean = frames(10, t => (t > 4 && t < 4.6 ? 0.5 + 3 * band : 0.5))
    expect(planShot(lean, 0, FPS)).toHaveLength(1)
  })

  it('follows a steady walk in stages rather than collapsing it into one badly framed hold', () => {
    const walk = frames(10, t => 0.3 + 0.04 * t)
    const track = planShot(walk, 0, FPS)
    expect(track.length).toBeGreaterThan(2)
    const metrics = framingMetrics(walk, track, 0, FPS)
    expect(metrics.offCentreShare).toBe(0)
  })

  it('does not chase a face into the frame edge the crop cannot pass', () => {
    const edge = frames(8, t => (t < 4 ? 0.02 : 0.1))
    expect(planShot(edge, 0, FPS)).toHaveLength(1)
  })
})

describe('framingMetrics', () => {
  it('scores a face far off-centre and counts within-shot moves', () => {
    const targets = frames(60, () => 0.5 + 0.3 * PORTRAIT_CROP_WIDTH)
    const metrics = framingMetrics(targets, [{ t: 0, x: 0.5, cut: true }, { t: 30, x: 0.505, pan: 1 }], 0, FPS)
    expect(metrics.offCentreShare).toBe(1)
    expect(metrics.movesPerMinute).toBeCloseTo(1)
    expect(metrics.movingShare).toBeGreaterThan(0)
  })

  it('derives the portrait crop width from the source aspect', () => {
    expect(portraitCropWidth(16 / 9)).toBeCloseTo(PORTRAIT_CROP_WIDTH)
    expect(portraitCropWidth(9 / 16)).toBe(1)
  })
})
