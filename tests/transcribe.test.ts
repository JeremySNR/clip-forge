import { describe, expect, it } from 'vitest'
import { stitchChunkResults, type ChunkResult } from '../src/main/pipeline/transcribe'
import type { AudioChunk } from '../src/main/pipeline/ffmpeg'
import type { WhisperResponse } from '../src/main/pipeline/openai'

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
