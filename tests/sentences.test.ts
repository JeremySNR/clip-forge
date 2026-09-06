import { describe, expect, it } from 'vitest'
import type { Transcript, TranscriptWord } from '@shared/types'
import {
  endsSentence,
  lastWordInClip,
  MAX_SENTENCE_SEC,
  normalizeClipEnd,
  sentenceAt,
  sentenceEndTimes,
  sentenceStartTimes,
  sentencesInRange,
  transcriptSentences
} from '../src/shared/sentences'
import { makeTranscript } from './helpers'

/** Two full sentences in one segment. */
function twoSentences(): Transcript {
  return {
    language: 'english',
    durationSec: 10,
    segments: [
      {
        id: 0,
        text: 'Hello there. This is next.',
        start: 0,
        end: 4,
        words: [
          { text: 'Hello', start: 0, end: 0.4 },
          { text: 'there.', start: 0.5, end: 0.9 },
          { text: 'This', start: 1.2, end: 1.5 },
          { text: 'is', start: 1.6, end: 1.8 },
          { text: 'next.', start: 1.9, end: 2.2 }
        ]
      }
    ]
  }
}

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

describe('sentenceStartTimes', () => {
  it('marks the first word and each word after a sentence end', () => {
    expect(sentenceStartTimes(twoSentences())).toEqual([0, 1.2])
  })

  it('returns a single start for a one-sentence transcript', () => {
    expect(sentenceStartTimes(transcriptEndingOnSo())).toEqual([0])
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

describe('transcriptSentences', () => {
  it('splits on word punctuation, not Whisper segments', () => {
    const sentences = transcriptSentences(transcriptEndingOnSo())
    // The segment break after "so" is not a sentence break; the full stop is.
    expect(sentences.map((s) => s.text)).toEqual(['and that is why it matters so much for everyone today.'])
    expect(sentences[0].start).toBe(0)
    expect(sentences[0].end).toBe(4.5)
  })

  it('numbers sentences in order and carries their words', () => {
    const sentences = transcriptSentences(twoSentences())
    expect(sentences.map((s) => s.index)).toEqual([0, 1])
    expect(sentences[1].words.map((w) => w.text)).toEqual(['This', 'is', 'next.'])
  })

  it('trusts segment punctuation when the last word lost it', () => {
    const t = makeTranscript(['no stop here', 'Second one.'])
    t.segments[0].text = 'no stop here.'
    expect(transcriptSentences(t).map((s) => s.text)).toEqual(['no stop here', 'Second one.'])
  })

  it('skips words cleared in the transcript editor', () => {
    const t = makeTranscript(['keep this one.'])
    t.segments[0].words[1].text = ''
    expect(transcriptSentences(t)[0].text).toBe('keep one.')
  })

  it('splits an unpunctuated ramble at its longest pause', () => {
    // 60 words, 0.5 s apart, no punctuation: one 30 s run. A 1.2 s pause sits
    // two thirds of the way through and is the natural split.
    const words: TranscriptWord[] = []
    let t = 0
    for (let i = 0; i < 60; i++) {
      words.push({ text: 'word', start: t, end: t + 0.3 })
      t += i === 39 ? 1.5 : 0.5
    }
    const transcript = {
      language: 'english',
      durationSec: t,
      segments: [{ id: 0, text: 'x', start: 0, end: t, words }]
    }
    const sentences = transcriptSentences(transcript)
    expect(sentences.length).toBeGreaterThanOrEqual(2)
    expect(sentences.every((s) => s.end - s.start <= MAX_SENTENCE_SEC)).toBe(true)
    // The split lands on the big pause.
    expect(sentences.some((s) => Math.abs(s.start - words[40].start) < 1e-6)).toBe(true)
    // Every word survives, in order.
    expect(sentences.flatMap((s) => s.words)).toEqual(words)
  })

  it('leaves a ramble whole when it has no pause worth splitting at', () => {
    const words = Array.from({ length: 60 }, (_, i) => ({ text: 'w', start: i * 0.5, end: i * 0.5 + 0.4 }))
    const transcript = { language: 'english', durationSec: 30, segments: [{ id: 0, text: 'x', start: 0, end: 30, words }] }
    expect(transcriptSentences(transcript)).toHaveLength(1)
  })

  it('averages segment energy into each sentence by word duration', () => {
    const t = makeTranscript(['Loud line here.', 'quiet line here.'])
    t.segments[0].energy = 0.9
    t.segments[1].energy = 0.1
    const [loud, quiet] = transcriptSentences(t)
    expect(loud.energy).toBe(0.9)
    expect(quiet.energy).toBe(0.1)
    const none = transcriptSentences(makeTranscript(['no energy.']))
    expect(none[0].energy).toBeUndefined()
  })
})

describe('sentenceAt / sentencesInRange', () => {
  const sentences = transcriptSentences(twoSentences())

  it('finds the sentence a moment falls inside and null in gaps', () => {
    expect(sentenceAt(sentences, 0.2)?.index).toBe(0)
    expect(sentenceAt(sentences, 1.6)?.index).toBe(1)
    // Between "there." (ends 0.9) and "This" (starts 1.2).
    expect(sentenceAt(sentences, 1.0)).toBeNull()
    expect(sentenceAt(sentences, 99)).toBeNull()
  })

  it('returns the sentences overlapping a range', () => {
    expect(sentencesInRange(sentences, 0.8, 1.3).map((s) => s.index)).toEqual([0, 1])
    expect(sentencesInRange(sentences, 1.3, 5).map((s) => s.index)).toEqual([1])
  })
})
