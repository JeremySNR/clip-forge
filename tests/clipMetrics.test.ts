import { describe, expect, it } from 'vitest'
import { analyzeClipBoundaries, summarizeBoundaries } from '@shared/clipMetrics'
import { makeTranscript } from './helpers'

describe('analyzeClipBoundaries', () => {
  // Words are 0.3 s with 0.1 s gaps; sentences 0.4 s apart.
  const transcript = makeTranscript(['One two three.', 'Four five six.', 'Seven eight nine.'])
  const words = transcript.segments.flatMap((s) => s.words)

  it('reports a clean clip as clean', () => {
    const start = words[3].start - 0.25 // "Four"
    const end = words[8].end + 0.6 // "nine."
    const r = analyzeClipBoundaries(transcript, start, end)
    expect(r.startsMidSentence).toBe(false)
    expect(r.endsMidSentence).toBe(false)
    expect(r.leadInSec).toBeCloseTo(0.25)
    expect(r.tailSec).toBeCloseTo(0.6)
    expect(r.openingSentence).toBe('Four five six.')
    expect(r.closingSentence).toBe('Seven eight nine.')
    expect(r.wordCount).toBe(6)
  })

  it('flags mid-sentence starts and ends', () => {
    const start = words[4].start - 0.1 // "five"
    const end = words[7].end + 0.2 // "eight"
    const r = analyzeClipBoundaries(transcript, start, end)
    expect(r.startsMidSentence).toBe(true)
    expect(r.endsMidSentence).toBe(true)
  })

  it('handles a clip with no words', () => {
    const r = analyzeClipBoundaries(transcript, 50, 60)
    expect(r.wordCount).toBe(0)
    expect(r.startsMidSentence).toBeNull()
    expect(r.tailSec).toBeNull()
  })
})

describe('summarizeBoundaries', () => {
  it('counts the failure modes and describes the length spread', () => {
    const base = {
      wordCount: 10,
      leadInSec: 0.25,
      startsMidSentence: false,
      endsMidSentence: false,
      openingSentence: 'a',
      closingSentence: 'b'
    }
    const s = summarizeBoundaries([
      { ...base, durationSec: 20, tailSec: 0.6 },
      { ...base, durationSec: 30, tailSec: 0.1, startsMidSentence: true },
      { ...base, durationSec: 40, tailSec: 3, endsMidSentence: true }
    ])
    expect(s.clips).toBe(3)
    expect(s.midSentenceStarts).toBe(1)
    expect(s.midSentenceEnds).toBe(1)
    expect(s.clippedTails).toBe(1)
    expect(s.deadAirTails).toBe(1)
    expect(s.medianDurationSec).toBe(30)
    expect(s.meanDurationSec).toBe(30)
    expect(s.minDurationSec).toBe(20)
    expect(s.maxDurationSec).toBe(40)
  })

  it('is well defined on no clips', () => {
    expect(summarizeBoundaries([]).clips).toBe(0)
  })
})
