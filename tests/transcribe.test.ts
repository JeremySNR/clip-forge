import { describe, expect, it } from 'vitest'
import {
  isHallucinatedSegment,
  MIN_WORD_SEC,
  normalizeWordTimings,
  stitchChunkResults,
  trustedChunkText,
  type ChunkResult
} from '../src/main/pipeline/transcribe'
import type { AudioChunk } from '../src/main/pipeline/ffmpeg'
import type { WhisperResponse, WhisperSegment } from '../src/main/pipeline/openai'

function chunk(offsetSec: number, keepFromSec: number, keepToSec: number): AudioChunk {
  return { path: `/tmp/a-${offsetSec}.mp3`, offsetSec, keepFromSec, keepToSec }
}

function response(
  duration: number,
  words: Array<[string, number, number]>,
  segments: Array<[string, number, number]>
): WhisperResponse {
  return {
    language: 'english',
    duration,
    text: words.map(([w]) => w).join(' '),
    words: words.map(([word, start, end]) => ({ word, start, end })),
    segments: segments.map(([text, start, end], id) => ({ id, text, start, end }))
  }
}

describe('stitchChunkResults', () => {
  it('offsets words and segments by the chunk position', () => {
    const results: ChunkResult[] = [
      {
        chunk: chunk(100, 0, Number.POSITIVE_INFINITY),
        res: response(10, [['hello', 1, 1.5], ['world', 2, 2.5]], [['hello world', 1, 2.5]])
      }
    ]
    const t = stitchChunkResults(results)
    expect(t.durationSec).toBe(110)
    expect(t.segments.length).toBe(1)
    expect(t.segments[0].start).toBe(101)
    expect(t.segments[0].words.map((w) => w.text)).toEqual(['hello', 'world'])
    expect(t.segments[0].words[0].start).toBe(101)
  })

  it('keeps each overlap word exactly once, from the owning chunk', () => {
    // Two chunks overlapping on [90, 110): windows split at 100.
    // Both transcribe the word at 99.5 and the word at 100.5.
    const results: ChunkResult[] = [
      {
        chunk: chunk(0, 0, 100),
        res: response(110, [['boundary', 99.5, 99.9], ['next', 100.5, 100.9]], [
          ['boundary next', 99.5, 100.9]
        ])
      },
      {
        chunk: chunk(90, 100, Number.POSITIVE_INFINITY),
        res: response(30, [['boundary', 9.5, 9.9], ['next', 10.5, 10.9]], [
          ['boundary next', 9.5, 10.9]
        ])
      }
    ]
    const t = stitchChunkResults(results)
    const words = t.segments.flatMap((s) => s.words)
    expect(words.filter((w) => w.text === 'boundary').length).toBe(1)
    expect(words.filter((w) => w.text === 'next').length).toBe(1)
    // "boundary" from chunk 1 (starts 99.5 < 100); "next" from chunk 2.
    expect(words.find((w) => w.text === 'boundary')!.start).toBeCloseTo(99.5)
    expect(words.find((w) => w.text === 'next')!.start).toBeCloseTo(100.5)
  })

  it('never loses a word at a chunk boundary', () => {
    // A word starting exactly on the split point belongs to the later chunk.
    const results: ChunkResult[] = [
      {
        chunk: chunk(0, 0, 100),
        res: response(110, [['early', 50, 50.4]], [['early', 50, 50.4]])
      },
      {
        chunk: chunk(90, 100, Number.POSITIVE_INFINITY),
        res: response(30, [['exact', 10, 10.4]], [['exact', 10, 10.4]])
      }
    ]
    const t = stitchChunkResults(results)
    const words = t.segments.flatMap((s) => s.words.map((w) => w.text))
    expect(words).toEqual(['early', 'exact'])
  })

  it('assigns every word to exactly one segment even when segments overlap', () => {
    const results: ChunkResult[] = [
      {
        chunk: chunk(0, 0, 100),
        res: response(
          110,
          [['a', 98, 98.3], ['b', 99, 99.3]],
          [['a b straddling', 98, 101]] // Whisper segment runs past the window
        )
      },
      {
        chunk: chunk(90, 100, Number.POSITIVE_INFINITY),
        res: response(30, [['c', 10.2, 10.5]], [['c onwards', 10.2, 12]])
      }
    ]
    const t = stitchChunkResults(results)
    const allWords = t.segments.flatMap((s) => s.words.map((w) => w.text))
    expect(allWords.sort()).toEqual(['a', 'b', 'c'])
    // Segment ids are renumbered sequentially.
    expect(t.segments.map((s) => s.id)).toEqual(t.segments.map((_, i) => i))
  })

  it('drops empty/whitespace words', () => {
    const results: ChunkResult[] = [
      {
        chunk: chunk(0, 0, Number.POSITIVE_INFINITY),
        res: response(10, [[' ', 1, 1.2], ['ok', 2, 2.2]], [['ok', 1, 2.2]])
      }
    ]
    const t = stitchChunkResults(results)
    expect(t.segments[0].words.map((w) => w.text)).toEqual(['ok'])
  })
})

describe('isHallucinatedSegment', () => {
  const seg = (extra: Partial<WhisperSegment>): WhisperSegment => ({
    id: 0,
    text: 'x',
    start: 0,
    end: 1,
    ...extra
  })

  it('trusts segments without diagnostics', () => {
    expect(isHallucinatedSegment(seg({}))).toBe(false)
  })

  it('flags silence-with-low-confidence text, as Whisper itself does', () => {
    expect(isHallucinatedSegment(seg({ no_speech_prob: 0.9, avg_logprob: -1.4 }))).toBe(true)
  })

  it('keeps a confident transcription even when no-speech probability is high', () => {
    // Quiet but clear speech: the decoder is sure of the words.
    expect(isHallucinatedSegment(seg({ no_speech_prob: 0.9, avg_logprob: -0.3 }))).toBe(false)
  })

  it('keeps low-confidence text that is clearly speech', () => {
    expect(isHallucinatedSegment(seg({ no_speech_prob: 0.1, avg_logprob: -1.4 }))).toBe(false)
  })

  it('flags looped output by compression ratio regardless of the other signals', () => {
    expect(isHallucinatedSegment(seg({ compression_ratio: 3.1, no_speech_prob: 0.05, avg_logprob: -0.2 }))).toBe(true)
    expect(isHallucinatedSegment(seg({ compression_ratio: 1.6 }))).toBe(false)
  })
})

describe('stitchChunkResults hallucination filtering', () => {
  it('drops hallucinated segments and the words inside them', () => {
    const res: WhisperResponse = {
      language: 'english',
      duration: 20,
      text: 'real words Thank you for watching',
      words: [
        { word: 'real', start: 1, end: 1.3 },
        { word: 'words', start: 1.4, end: 1.8 },
        { word: 'Thank', start: 10, end: 10.3 },
        { word: 'you', start: 10.4, end: 10.6 },
        { word: 'for', start: 10.7, end: 10.9 },
        { word: 'watching', start: 11, end: 11.5 }
      ],
      segments: [
        { id: 0, text: 'real words', start: 1, end: 1.8, no_speech_prob: 0.02, avg_logprob: -0.2 },
        {
          id: 1,
          text: 'Thank you for watching',
          start: 9.5,
          end: 12,
          no_speech_prob: 0.93,
          avg_logprob: -1.6
        }
      ]
    }
    const t = stitchChunkResults([{ chunk: chunk(0, 0, Number.POSITIVE_INFINITY), res }])
    expect(t.segments.map((s) => s.text)).toEqual(['real words'])
    expect(t.segments.flatMap((s) => s.words.map((w) => w.text))).toEqual(['real', 'words'])
  })

  it('primes the next chunk with trusted text only', () => {
    const res: WhisperResponse = {
      language: 'english',
      duration: 20,
      text: 'good stuff Subtitles by Amara',
      segments: [
        { id: 0, text: ' good stuff ', start: 0, end: 2 },
        { id: 1, text: 'Subtitles by Amara', start: 15, end: 18, no_speech_prob: 0.8, avg_logprob: -1.2 }
      ]
    }
    expect(trustedChunkText(res)).toBe('good stuff')
  })

  it('falls back to the plain text when a response has no segments', () => {
    expect(trustedChunkText({ language: 'english', duration: 1, text: 'hi there' })).toBe('hi there')
  })
})

describe('normalizeWordTimings', () => {
  it('gives zero-length words a visible duration inside the gap before the next word', () => {
    const words = normalizeWordTimings([
      { text: 'a', start: 1, end: 1 },
      { text: 'b', start: 2, end: 2.3 }
    ])
    expect(words[0].end).toBeCloseTo(1.15)
    expect(words[0].end).toBeLessThanOrEqual(words[1].start)
  })

  it('repairs a word that ends before it starts', () => {
    const [w] = normalizeWordTimings([{ text: 'a', start: 5, end: 4.8 }])
    expect(w.end).toBeGreaterThanOrEqual(w.start + MIN_WORD_SEC)
  })

  it('removes overlaps so each word starts where the previous one ends', () => {
    const words = normalizeWordTimings([
      { text: 'a', start: 0, end: 0.6 },
      { text: 'b', start: 0.4, end: 0.9 }
    ])
    expect(words[1].start).toBe(0.6)
    expect(words[1].end).toBe(0.9)
  })

  it('never creates an empty window even in a tight cluster', () => {
    const words = normalizeWordTimings([
      { text: 'a', start: 1, end: 1 },
      { text: 'b', start: 1.01, end: 1.01 },
      { text: 'c', start: 1.02, end: 1.02 }
    ])
    for (let i = 0; i < words.length; i++) {
      expect(words[i].end - words[i].start).toBeGreaterThanOrEqual(MIN_WORD_SEC - 1e-9)
      if (i > 0) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].end)
    }
  })

  it('leaves clean timings untouched', () => {
    const words = normalizeWordTimings([
      { text: 'a', start: 0, end: 0.3 },
      { text: 'b', start: 0.4, end: 0.7 }
    ])
    expect(words).toEqual([
      { text: 'a', start: 0, end: 0.3 },
      { text: 'b', start: 0.4, end: 0.7 }
    ])
  })
})
