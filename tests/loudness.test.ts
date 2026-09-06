import { describe, expect, it } from 'vitest'
import {
  loudnormFilter,
  MAX_GAIN_DB,
  MEASURE_FILTER,
  normalisationMode,
  parseLoudnormStats
} from '../src/main/pipeline/loudness'

const STDERR = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':
  Duration: 00:00:30.00, start: 0.000000, bitrate: 2500 kb/s
[Parsed_loudnorm_0 @ 0x55d0] 
{
\t"input_i" : "-27.61",
\t"input_tp" : "-4.47",
\t"input_lra" : "18.06",
\t"input_thresh" : "-39.20",
\t"output_i" : "-22.03",
\t"output_tp" : "-1.50",
\t"output_lra" : "9.50",
\t"output_thresh" : "-32.60",
\t"normalization_type" : "dynamic",
\t"target_offset" : "0.47"
}
`

describe('parseLoudnormStats', () => {
  it('reads the measurement block loudnorm prints on stderr', () => {
    expect(parseLoudnormStats(STDERR)).toEqual({
      inputI: -27.61,
      inputTp: -4.47,
      inputLra: 18.06,
      inputThresh: -39.2,
      targetOffset: 0.47
    })
  })

  it('returns null for silent input (loudnorm reports -inf)', () => {
    const silent = STDERR.replace('"-27.61"', '"-inf"')
    expect(parseLoudnormStats(silent)).toBeNull()
  })

  it('returns null when there is no block at all', () => {
    expect(parseLoudnormStats('ffmpeg version 6.1\nno audio here')).toBeNull()
    expect(parseLoudnormStats('{ not json')).toBeNull()
  })
})

describe('loudnormFilter', () => {
  it('runs single-pass when nothing was measured', () => {
    expect(loudnormFilter(null)).toBe('loudnorm=I=-14:TP=-1.5:LRA=11')
  })

  it('feeds the measurements back for linear normalisation when peaks allow', () => {
    // -27.61 -> -14 needs +13.61 dB; TP -4.47 would land at +9.1, over the
    // ceiling, so this source cannot take the loudnorm linear path.
    const stats = parseLoudnormStats(STDERR)!
    expect(normalisationMode(stats)).toBe('limited')
    const quiet = { ...stats, inputTp: -16 }
    expect(normalisationMode(quiet)).toBe('linear')
    // The range target is raised to the measured range (18.06 -> 18.1):
    // loudnorm refuses linear mode when the target is below the source.
    expect(loudnormFilter(quiet)).toBe(
      'loudnorm=I=-14:TP=-1.5:LRA=18.10:measured_I=-27.61:measured_TP=-16.00:measured_LRA=18.06:measured_thresh=-39.20:offset=0.47:linear=true'
    )
  })

  it('keeps the default range target for narrow-range sources', () => {
    const stats = { inputI: -20, inputTp: -10, inputLra: 4.4, inputThresh: -31, targetOffset: 0.1 }
    expect(loudnormFilter(stats)).toContain(':LRA=11.00:')
  })

  it('applies a plain gain into a limiter when the peak would exceed the ceiling', () => {
    const stats = { inputI: -24, inputTp: -6, inputLra: 9, inputThresh: -35, targetOffset: 0.3 }
    expect(normalisationMode(stats)).toBe('limited')
    // +10 dB gain, limiter just under -1.5 dBTP, no auto-levelling.
    expect(loudnormFilter(stats)).toBe('volume=10.00dB,alimiter=limit=0.7943:attack=5:release=50:level=false')
  })

  it('caps the limiter-path gain for broken, near-silent sources', () => {
    const stats = { inputI: -60, inputTp: -20, inputLra: 5, inputThresh: -70, targetOffset: 0 }
    expect(loudnormFilter(stats)).toContain(`volume=${MAX_GAIN_DB.toFixed(2)}dB`)
  })

  it('measures against the same targets it normalises to', () => {
    expect(MEASURE_FILTER).toBe('loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json')
  })
})
