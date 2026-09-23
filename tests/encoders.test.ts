import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: undefined }))
import { encoderArgs } from '../src/main/pipeline/encoders'

describe('encoderArgs', () => {
  it('uses the hardware-only VideoToolbox encoder with rising quality per tier', () => {
    const args = (tier: 'draft' | 'standard' | 'high'): string[] => encoderArgs('videotoolbox', tier)
    expect(args('standard')).toEqual(expect.arrayContaining(['-c:v', 'h264_videotoolbox', '-allow_sw', '0', '-pix_fmt', 'yuv420p']))
    const q = (tier: 'draft' | 'standard' | 'high'): number => Number(args(tier)[args(tier).indexOf('-q:v') + 1])
    expect(q('draft')).toBeLessThan(q('standard'))
    expect(q('standard')).toBeLessThan(q('high'))
  })
})
