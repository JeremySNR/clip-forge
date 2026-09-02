import { describe, expect, it } from 'vitest'
import { planUploadEncode, type UploadEncodeInput } from '@shared/uploadBudget'

const MB = 1024 * 1024

/** A 9:16 talking-head clip, the shape this planner exists for. */
function vertical(overrides: Partial<UploadEncodeInput> = {}): UploadEncodeInput {
  return {
    capBytes: 18 * MB,
    durationSec: 60,
    width: 1080,
    height: 1920,
    sourceFps: 30,
    hasAudio: true,
    ...overrides
  }
}

describe('planUploadEncode', () => {
  it('fits the estimate inside the cap', () => {
    const plan = planUploadEncode(vertical())
    expect(plan.estimatedBytes).toBeLessThanOrEqual(18 * MB)
    // The reserved overhead should be real, not a rounding accident.
    expect(plan.estimatedBytes).toBeGreaterThan(17 * MB)
  })

  it('keeps full resolution for a 60s clip at an 18MB cap', () => {
    const plan = planUploadEncode(vertical())
    expect(plan.downscaled).toBe(false)
    expect(plan.width).toBe(1080)
    expect(plan.height).toBe(1920)
    expect(plan.overBudget).toBe(false)
  })

  it('downscales rather than starve 1080p at a 10MB cap', () => {
    const plan = planUploadEncode(vertical({ capBytes: 10 * MB }))
    expect(plan.downscaled).toBe(true)
    expect(plan.height).toBeLessThan(1920)
    expect(plan.height).toBeGreaterThan(1080)
    expect(plan.estimatedBytes).toBeLessThanOrEqual(10 * MB)
  })

  it('scales further as the clip gets longer at a fixed cap', () => {
    const short = planUploadEncode(vertical({ durationSec: 30 }))
    const long = planUploadEncode(vertical({ durationSec: 180 }))
    expect(short.downscaled).toBe(false)
    expect(long.downscaled).toBe(true)
    expect(long.height).toBeLessThan(short.height)
    expect(long.videoKbps).toBeLessThan(short.videoKbps)
  })

  it('always returns even dimensions so yuv420p stays valid', () => {
    for (const durationSec of [15, 45, 73, 120, 200, 401]) {
      const plan = planUploadEncode(vertical({ durationSec }))
      expect(plan.width % 2).toBe(0)
      expect(plan.height % 2).toBe(0)
    }
  })

  it('caps a 60fps source at 30 but leaves 24fps alone', () => {
    expect(planUploadEncode(vertical({ sourceFps: 60 })).fps).toBe(30)
    expect(planUploadEncode(vertical({ sourceFps: 24 })).fps).toBe(24)
  })

  it('falls back to 30fps when the source frame rate is unusable', () => {
    expect(planUploadEncode(vertical({ sourceFps: 0 })).fps).toBe(30)
    expect(planUploadEncode(vertical({ sourceFps: Number.NaN })).fps).toBe(30)
  })

  it('spends the whole budget on video when the clip is silent', () => {
    const silent = planUploadEncode(vertical({ hasAudio: false }))
    const withAudio = planUploadEncode(vertical())
    expect(silent.audioKbps).toBe(0)
    expect(silent.videoKbps).toBeGreaterThan(withAudio.videoKbps)
  })

  it('drops to a leaner audio rate only when the budget is tight', () => {
    expect(planUploadEncode(vertical()).audioKbps).toBe(128)
    expect(planUploadEncode(vertical({ durationSec: 600 })).audioKbps).toBe(96)
  })

  it('stops downscaling at the floor and flags the clip as over budget', () => {
    const plan = planUploadEncode(vertical({ durationSec: 3600 }))
    expect(plan.overBudget).toBe(true)
    // 40% of 1080x1920, rounded even.
    expect(plan.width).toBe(432)
    expect(plan.height).toBe(768)
    expect(plan.videoKbps).toBeGreaterThanOrEqual(150)
  })

  it('handles a landscape target without inverting the frame', () => {
    const plan = planUploadEncode(vertical({ width: 1920, height: 1080, capBytes: 10 * MB }))
    expect(plan.width).toBeGreaterThan(plan.height)
    expect(plan.width / plan.height).toBeCloseTo(1920 / 1080, 1)
  })

  it('survives degenerate input without producing NaN', () => {
    const plan = planUploadEncode(vertical({ capBytes: 0, durationSec: 0 }))
    expect(Number.isFinite(plan.videoKbps)).toBe(true)
    expect(Number.isFinite(plan.width)).toBe(true)
    expect(Number.isFinite(plan.height)).toBe(true)
    expect(plan.videoKbps).toBeGreaterThanOrEqual(150)
  })
})
