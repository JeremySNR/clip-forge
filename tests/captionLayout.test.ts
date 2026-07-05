import { describe, expect, it } from 'vitest'
import { groupWords, wordsInRange } from '@shared/captionLayout'
import { makeTranscript } from './helpers'
import type { TranscriptWord } from '@shared/types'

const word = (text: string, start: number, end: number): TranscriptWord => ({ text, start, end })

describe('wordsInRange', () => {
  it('selects words whose midpoint falls inside the clip', () => {
    const transcript = makeTranscript(['one two three four five'], { wordSec: 1, gapSec: 0 })
    // Words at [0,1] [1,2] [2,3] [3,4] [4,5]; clip [1.6, 3.9] catches midpoints 2.5 and 3.5.
    const words = wordsInRange(transcript, 1.6, 3.9)
    expect(words.map((w) => w.text)).toEqual(['three', 'four'])
  })

  it('skips empty words (cleared in the transcript editor)', () => {
    const transcript = makeTranscript(['a b c'])
    transcript.segments[0].words[1].text = ''
    const words = wordsInRange(transcript, 0, transcript.durationSec)
    expect(words.map((w) => w.text)).toEqual(['a', 'c'])
  })

  it('returns words sorted by start time across segments', () => {
    const transcript = makeTranscript(['later words', 'earlier words'])
    // Swap segment order to prove sorting.
    transcript.segments.reverse()
    const words = wordsInRange(transcript, 0, transcript.durationSec)
    const starts = words.map((w) => w.start)
    expect([...starts].sort((a, b) => a - b)).toEqual(starts)
  })
})

describe('groupWords', () => {
  it('respects the max group size', () => {
    const words = [
      word('a', 0, 0.2),
      word('b', 0.3, 0.5),
      word('c', 0.6, 0.8),
      word('d', 0.9, 1.1)
    ]
    const groups = groupWords(words, 3)
    expect(groups.map((g) => g.words.length)).toEqual([3, 1])
  })

  it('breaks groups on long pauses', () => {
    const words = [word('before', 0, 0.3), word('after', 2, 2.3)]
    const groups = groupWords(words, 5)
    expect(groups.length).toBe(2)
  })

  it('breaks groups after sentence-ending punctuation', () => {
    const words = [word('done.', 0, 0.3), word('next', 0.5, 0.8)]
    const groups = groupWords(words, 5)
    expect(groups.length).toBe(2)
  })

  it('records group start/end from its words', () => {
    const words = [word('a', 1, 1.4), word('b', 1.5, 2)]
    const [group] = groupWords(words, 5)
    expect(group.start).toBe(1)
    expect(group.end).toBe(2)
  })
})
