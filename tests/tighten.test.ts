import { describe, expect, it } from 'vitest'
import { computeKeptSegments, remapTranscript, TimeMap } from '@shared/tighten'
import { makeTranscript } from './helpers'

describe('computeKeptSegments', () => {
  it('returns null when there is nothing worth cutting', () => {
    const transcript = makeTranscript(['a steady stream of words with no real pauses'], {
      gapSec: 0.05,
      startSec: 0
    })
    expect(computeKeptSegments(transcript, 0, transcript.durationSec)).toBeNull()
  })

  it('cuts a long pause between sentences', () => {
    const transcript = makeTranscript(['first thought ends here', 'second thought starts'], {
      sentenceGapSec: 3
    })
    const segments = computeKeptSegments(transcript, 0, transcript.durationSec)
    expect(segments).not.toBeNull()
    expect(segments!.length).toBe(2)
    const removed =
      transcript.durationSec - segments!.reduce((sum, s) => sum + (s.end - s.start), 0)
    expect(removed).toBeGreaterThan(1.5)
  })

  it('drops filler words so their span can be removed', () => {
    // "um" sits alone between two long pauses; removing it merges nothing.
    const transcript = makeTranscript(['solid opening words here', 'um', 'and the point lands'], {
      sentenceGapSec: 1.2
    })
    const segments = computeKeptSegments(transcript, 0, transcript.durationSec)
    expect(segments).not.toBeNull()
    // The kept spans must not contain the "um" word's midpoint.
    const um = transcript.segments[1].words[0]
    const mid = (um.start + um.end) / 2
    expect(segments!.some((s) => mid >= s.start && mid <= s.end)).toBe(false)
  })

  it('returns null for clips with fewer than three words', () => {
    const transcript = makeTranscript(['hi there'])
    expect(computeKeptSegments(transcript, 0, transcript.durationSec)).toBeNull()
  })

  it('does not machine-gun cut dense filler', () => {
    // A word every ~1.2s with an "um" between each. Cutting every filler would
    // produce one jump cut per word (the reported jitter); the anti-jitter
    // pass must collapse that to at most a couple of clean segments.
    const words = []
    const N = 8
    for (let i = 0; i < N; i++) {
      const base = i * 1.2
      words.push({ text: 'word', start: base, end: base + 0.3 })
      words.push({ text: 'um', start: base + 0.5, end: base + 0.9 })
    }
    const last = words[words.length - 1].end
    const transcript = {
      language: 'english',
      durationSec: last,
      segments: [{ id: 0, text: 'x', start: 0, end: last, words }]
    }
    const kept = computeKeptSegments(transcript, 0, last)
    expect(kept === null || kept.length <= 2).toBe(true)
  })

  it('still cuts a genuine long pause amid filler', () => {
    const words = []
    // Stammer block, then a long silence, then a clean run of speech.
    for (let i = 0; i < 3; i++) {
      const b = i * 1.2
      words.push({ text: 'word', start: b, end: b + 0.3 })
      words.push({ text: 'um', start: b + 0.5, end: b + 0.9 })
    }
    for (let i = 0; i < 4; i++) {
      const b = 6 + i * 0.4
      words.push({ text: 'more', start: b, end: b + 0.3 })
    }
    const last = words[words.length - 1].end
    const transcript = {
      language: 'english',
      durationSec: last,
      segments: [{ id: 0, text: 'x', start: 0, end: last, words }]
    }
    const kept = computeKeptSegments(transcript, 0, last)
    expect(kept).not.toBeNull()
    expect(kept!.length).toBe(2)
  })
})

describe('TimeMap', () => {
  const segments = [
    { start: 10, end: 12 },
    { start: 15, end: 18 }
  ]
  const map = new TimeMap(segments)

  it('computes the compacted duration', () => {
    expect(map.outputDuration).toBe(5)
  })

  it('maps kept times linearly and clamps removed spans', () => {
    expect(map.toOutput(10)).toBe(0)
    expect(map.toOutput(11)).toBe(1)
    expect(map.toOutput(12)).toBe(2)
    expect(map.toOutput(13.5)).toBe(2) // inside the removed gap
    expect(map.toOutput(15)).toBe(2)
    expect(map.toOutput(18)).toBe(5)
    expect(map.toOutput(99)).toBe(5)
    expect(map.toOutput(0)).toBe(0) // before the first kept span
  })

  it('identifies removed spans and the next kept start', () => {
    expect(map.isRemoved(11)).toBe(false)
    expect(map.isRemoved(13)).toBe(true)
    expect(map.nextKeptStart(13)).toBe(15)
    expect(map.nextKeptStart(16)).toBeNull()
    expect(map.nextKeptStart(20)).toBeNull()
  })
})

describe('remapTranscript', () => {
  it('drops words in removed spans and shifts the rest', () => {
    const transcript = makeTranscript(['keep these words', 'cut me', 'keep the ending'], {
      wordSec: 0.5,
      gapSec: 0.1
    })
    const cutSegment = transcript.segments[1]
    const kept = [
      { start: 0, end: cutSegment.start - 0.01 },
      { start: cutSegment.end + 0.01, end: transcript.durationSec }
    ]
    const map = new TimeMap(kept)
    const out = remapTranscript(transcript, map, 0, transcript.durationSec)

    const words = out.segments.flatMap((s) => s.words.map((w) => w.text))
    expect(words).toContain('keep')
    expect(words).toContain('ending')
    expect(words).not.toContain('cut')
    // Remapped times stay within the compacted duration.
    for (const seg of out.segments) {
      for (const w of seg.words) {
        expect(w.start).toBeGreaterThanOrEqual(0)
        expect(w.end).toBeLessThanOrEqual(map.outputDuration + 0.01)
      }
    }
  })
})
