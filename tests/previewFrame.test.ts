import { describe, expect, it } from 'vitest'
import {
  previewFocusX,
  previewZoom,
  smoothPlaybackTime,
  type PreviewFramePlan
} from '@shared/previewFrame'
import type { ZoomEvent } from '@shared/zoom'

const basePlan = (): PreviewFramePlan => ({
  zoomEvents: null,
  focusTrack: null,
  framing: 'manual',
  manualFocusX: 0.5,
  isCrop: true
})

describe('smoothPlaybackTime', () => {
  it('returns raw time when paused or seeking', () => {
    expect(smoothPlaybackTime({ currentTime: 3, paused: true, seeking: false }, { mediaTime: 0, wallAt: 0 }).t).toBe(3)
    expect(smoothPlaybackTime({ currentTime: 3, paused: false, seeking: true }, { mediaTime: 0, wallAt: 0 }).t).toBe(3)
  })

  it('extrapolates between currentTime updates while playing', () => {
    const video = { currentTime: 10, paused: false, seeking: false }
    const anchored = smoothPlaybackTime(video, { mediaTime: 10, wallAt: 1000 }, 1033.333)
    expect(anchored.t).toBeCloseTo(10.0333, 3)
    expect(anchored.clock.mediaTime).toBe(10)
  })

  it('re-anchors when currentTime advances', () => {
    const video = { currentTime: 10.033, paused: false, seeking: false }
    const next = smoothPlaybackTime(video, { mediaTime: 10, wallAt: 1000 }, 1033.333)
    expect(next.clock.mediaTime).toBe(10.033)
    expect(next.t).toBeCloseTo(10.033, 3)
  })
})

describe('previewZoom', () => {
  const creep: ZoomEvent[] = [{ start: 0, end: 8, from: 1, to: 1.08, style: 'creep' }]

  it('interpolates zoom between coarse time steps', () => {
    const plan = { ...basePlan(), zoomEvents: creep }
    const a = previewZoom(plan, 0)
    const b = previewZoom(plan, 4)
    expect(b).toBeGreaterThan(a)
    expect(previewZoom(plan, 8)).toBeCloseTo(1.08)
  })
})

describe('previewFocusX', () => {
  it('reads the auto focus track', () => {
    const plan: PreviewFramePlan = {
      ...basePlan(),
      framing: 'auto',
      focusTrack: [
        { t: 0, x: 0.4, cut: true },
        { t: 5, x: 0.6 }
      ]
    }
    expect(previewFocusX(plan, 0)).toBeCloseTo(0.4)
    const mid = previewFocusX(plan, 5.3)
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
  })
})
