import { describe, expect, it } from 'vitest'
import { loudnormFilter, MEASURE_FILTER, parseLoudnormStats } from '../src/main/pipeline/loudness'

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

  it('feeds the measurements back for linear normalisation', () => {
    const stats = parseLoudnormStats(STDERR)!
    expect(loudnormFilter(stats)).toBe(
      'loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-27.61:measured_TP=-4.47:measured_LRA=18.06:measured_thresh=-39.20:offset=0.47:linear=true'
    )
  })

  it('measures against the same targets it normalises to', () => {
    expect(MEASURE_FILTER).toBe('loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json')
  })
})
