import { describe, expect, it } from 'vitest'
import { speechRegions } from '../src/main/pipeline/vad'
import { snapToSilence } from '@shared/tighten'

const CHUNK = 0.032
const probs = (spec: Array<[number, number]>): number[] => spec.flatMap(([p, seconds]) => Array(Math.round(seconds / CHUNK)).fill(p))

describe('speechRegions', () => {
  it('pads speech and bridges brief dips below the threshold', () => {
    const regions = speechRegions(probs([[0.1, 1], [0.9, 2], [0.4, 0.3], [0.9, 1], [0.05, 1]]))
    expect(regions).toHaveLength(1) // 0.4 stays above the negative threshold
    expect(regions[0].start).toBeCloseTo(1 - 0.03, 1)
    expect(regions[0].end).toBeCloseTo(4.3 + 0.03, 1)
  })

  it('splits on real silence and drops blips shorter than the minimum speech', () => {
    const regions = speechRegions(probs([[0.9, 1], [0.05, 0.5], [0.9, 0.1], [0.05, 0.5], [0.9, 1]]))
    expect(regions).toHaveLength(2)
  })
})

describe('snapToSilence', () => {
  const speech = [{ start: 0, end: 5.2 }, { start: 6.8, end: 10 }]

  it('moves cut points out of speech to where sound actually stops and starts', () => {
    expect(snapToSilence([{ start: 0, end: 5 }, { start: 7, end: 10 }], speech))
      .toEqual([{ start: 0, end: 5.2 }, { start: 6.8, end: 10 }])
  })

  it('does not cut when the silence left is too short to remove', () => {
    expect(snapToSilence([{ start: 0, end: 5 }, { start: 7, end: 10 }], [{ start: 0, end: 6.7 }, { start: 6.8, end: 10 }]))
      .toEqual([{ start: 0, end: 10 }])
  })

  it('leaves word-timed cuts alone without voice activity', () => {
    const kept = [{ start: 0, end: 5 }, { start: 7, end: 10 }]
    expect(snapToSilence(kept)).toBe(kept)
  })
})

describe('filler removal with voice activity', () => {
  it('still removes an "um" inside continuous speech', () => {
    const speech = [{ start: 0, end: 10 }]
    const kept = [{ start: 0, end: 1.3 }, { start: 1.82, end: 10 }]
    expect(snapToSilence(kept, speech, [{ start: 1.2, end: 1.8 }])).toEqual(kept)
    // Without the filler the same gap is sound, so it is not cut.
    expect(snapToSilence(kept, speech)).toEqual([{ start: 0, end: 10 }])
  })
})
