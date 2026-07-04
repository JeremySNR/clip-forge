import { describe, expect, it } from 'vitest'
import { computeWaveform } from '../src/main/pipeline/timeline'

function pcmOf(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(v * 32767), i * 2))
  return buf
}

describe('computeWaveform', () => {
  it('returns empty for empty input', () => {
    expect(computeWaveform(Buffer.alloc(0), 10)).toEqual([])
  })

  it('normalises the loudest bucket to 1', () => {
    // First half quiet, second half loud.
    const samples = [...Array(100).fill(0.1), ...Array(100).fill(0.8)]
    const wave = computeWaveform(pcmOf(samples), 4)
    expect(wave.length).toBe(4)
    expect(Math.max(...wave)).toBe(1)
    expect(wave[0]).toBeCloseTo(0.125, 2) // 0.1 / 0.8
    expect(wave[3]).toBe(1)
  })

  it('keeps silence at zero', () => {
    const wave = computeWaveform(pcmOf(Array(200).fill(0)), 8)
    expect(wave.every((v) => v === 0)).toBe(true)
  })

  it('emits at most the requested bucket count', () => {
    const wave = computeWaveform(pcmOf(Array(1000).fill(0.5)), 160)
    expect(wave.length).toBeLessThanOrEqual(160)
    expect(wave.length).toBeGreaterThan(150)
  })
})
