import { describe, expect, it } from 'vitest'
import type { Transcript } from '@shared/types'
import {
  endsSentence,
  lastWordInClip,
  normalizeClipEnd,
  sentenceEndTimes
} from '../src/shared/sentences'

/** Whisper often breaks before the thought completes — e.g. segment ends on "so". */
function transcriptEndingOnSo(): Transcript {
  return {
    language: 'english',
    durationSec: 20,
    segments: [
      {
        id: 0,
        text: 'and that is why it matters so',
        start: 0,
        end: 3.4,
        words: [
          { text: 'and', start: 0, end: 0.3 },
          { text: 'that', start: 0.4, end: 0.7 },
          { text: 'is', start: 0.8, end: 1.1 },
          { text: 'why', start: 1.2, end: 1.5 },
          { text: 'it', start: 1.6, end: 1.9 },
          { text: 'matters', start: 2.0, end: 2.3 },
          { text: 'so', start: 2.4, end: 2.7 }
        ]
      },
      {
        id: 1,
        text: 'much for everyone today.',
        start: 3.0,
        end: 6.4,
        words: [
          { text: 'much', start: 3.0, end: 3.3 },
          { text: 'for', start: 3.4, end: 3.7 },
          { text: 'everyone', start: 3.8, end: 4.1 },
          { text: 'today.', start: 4.2, end: 4.5 }
        ]
      }
    ]
  }
}

describe('endsSentence', () => {
  it('detects terminal punctuation', () => {
    expect(endsSentence('today.')).toBe(true)
    expect(endsSentence('really?')).toBe(true)
    expect(endsSentence('wow!')).toBe(true)
    expect(endsSentence('so')).toBe(false)
  })
})

describe('sentenceEndTimes', () => {
  it('uses word punctuation, not Whisper segment ends', () => {
    const ends = sentenceEndTimes(transcriptEndingOnSo())
    expect(ends).toEqual([4.5])
  })
})

describe('normalizeClipEnd', () => {
  const transcript = transcriptEndingOnSo()
  const postRollSec = 0.6

  it('extends past a segment boundary that ends on "so"', () => {
    // Segment 0 ends at 2.7s on the word "so"; the real sentence ends at 4.5s.
    const end = normalizeClipEnd(0, 3.3, transcript, 20, { postRollSec })
    expect(end).toBeCloseTo(4.5 + postRollSec, 5)
  })

  it('leaves a clip that already ends on a sentence', () => {
    const end = normalizeClipEnd(0, 5.1, transcript, 20, { postRollSec })
    expect(end).toBeCloseTo(5.1, 5)
    expect(lastWordInClip(transcript, 0, end)?.text).toBe('today.')
  })

  it('does not extend beyond the cap', () => {
    const end = normalizeClipEnd(0, 3.3, transcript, 20, { postRollSec, maxExtendSec: 0.5 })
    expect(end).toBe(3.3)
  })
})
