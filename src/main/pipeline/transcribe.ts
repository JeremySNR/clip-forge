import type { Transcript, TranscriptSegment, TranscriptWord } from '@shared/types'
import { transcribeAudioFile, type WhisperResponse } from './openai'
import type { AudioChunk } from './ffmpeg'

/**
 * Chunked transcription with overlap-aware stitching. Consecutive audio
 * chunks overlap by a few seconds so Whisper sees full context on both sides
 * of a boundary; the stitcher then takes each word from the single chunk
 * whose responsibility window owns its timestamp, so boundary words are
 * neither lost nor duplicated.
 */

export interface ChunkResult {
  chunk: AudioChunk
  res: WhisperResponse
}

/**
 * Merge per-chunk Whisper responses into one transcript with absolute
 * timestamps. Pure and exported for unit tests.
 *
 * - Words: kept from the chunk whose [keepFromSec, keepToSec) window contains
 *   their start — a disjoint tiling, so the merged word pool has no
 *   duplicates and no gaps.
 * - Segments: kept when their start falls in the window (Whisper segments the
 *   overlap region differently per chunk, so exact segment tiling is
 *   impossible; starts are a stable rule).
 * - Each word is then assigned to the last kept segment starting at or before
 *   it, guaranteeing every word appears in exactly one segment even when
 *   segments from different chunks overlap around a boundary.
 */
export function stitchChunkResults(results: ChunkResult[]): Transcript {
  let language = 'english'
  let duration = 0

  const pool: TranscriptWord[] = []
  const segments: TranscriptSegment[] = []

  for (const { chunk, res } of results) {
    language = res.language ?? language
    duration = Math.max(duration, chunk.offsetSec + (res.duration ?? 0))
    const inWindow = (absStart: number): boolean =>
      absStart >= chunk.keepFromSec && absStart < chunk.keepToSec

    for (const w of res.words ?? []) {
      const start = w.start + chunk.offsetSec
      if (!inWindow(start)) continue
      const text = w.word.trim()
      if (text.length === 0) continue
      pool.push({ text, start, end: w.end + chunk.offsetSec })
    }

    for (const seg of res.segments ?? []) {
      const start = seg.start + chunk.offsetSec
      if (!inWindow(start)) continue
      segments.push({
        id: 0, // renumbered after sorting
        text: seg.text.trim(),
        start,
        end: seg.end + chunk.offsetSec,
        words: []
      })
    }
  }

  pool.sort((a, b) => a.start - b.start)
  segments.sort((a, b) => a.start - b.start)
  segments.forEach((seg, i) => (seg.id = i))

  // Assign each word to the last segment starting at or before it (with a
  // small epsilon so words exactly on a segment boundary land in one place).
  let segIdx = 0
  for (const word of pool) {
    while (segIdx + 1 < segments.length && segments[segIdx + 1].start <= word.start + 0.01) {
      segIdx++
    }
    if (segments.length > 0) segments[segIdx].words.push(word)
  }
  // Words can outrun a segment's Whisper-reported end near chunk boundaries.
  for (const seg of segments) {
    const lastWord = seg.words[seg.words.length - 1]
    if (lastWord) seg.end = Math.max(seg.end, lastWord.end)
  }

  return { language, durationSec: duration, segments }
}

/**
 * Transcribe all audio chunks (sequentially: the tail of each chunk's text is
 * passed to the next as a Whisper prompt so terminology stays consistent
 * across boundaries) and stitch the results.
 */
export async function transcribeChunks(
  apiKey: string,
  model: string,
  chunks: AudioChunk[],
  language: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<Transcript> {
  const results: ChunkResult[] = []
  let previousTail = ''

  for (let i = 0; i < chunks.length; i++) {
    signal?.throwIfAborted()
    const chunk = chunks[i]
    const res = await transcribeAudioFile(apiKey, chunk.path, model, {
      contextPrompt: previousTail || undefined,
      language,
      signal
    })
    previousTail = (res.text ?? '').slice(-600)
    results.push({ chunk, res })
    onProgress?.((i + 1) / chunks.length)
  }

  return stitchChunkResults(results)
}
