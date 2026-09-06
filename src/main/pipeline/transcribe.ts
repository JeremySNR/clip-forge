import type { Transcript, TranscriptSegment, TranscriptWord } from '@shared/types'
import { transcribeAudioFile, type WhisperResponse, type WhisperSegment } from './openai'
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
 * Whisper's own thresholds for treating a decoded segment as silence: it
 * only trusts a high no-speech probability when the text it produced is also
 * low-confidence. A segment failing both is what it emits over music, room
 * tone and dead air — "Thank you for watching", a repeated phrase, a stray
 * sentence in another language.
 */
export const NO_SPEECH_THRESHOLD = 0.6
export const LOGPROB_THRESHOLD = -1.0
/**
 * gzip ratio of the segment text above which the decoder has looped. Real
 * speech compresses to roughly 1.3–1.8; "you you you you you" goes far past
 * this. Whisper itself uses the same cut-off to reject a decoding attempt.
 */
export const COMPRESSION_RATIO_THRESHOLD = 2.4

/**
 * Whether a Whisper segment is a decoder hallucination rather than speech.
 * Segments without diagnostics are trusted. Pure and exported for tests.
 */
export function isHallucinatedSegment(seg: WhisperSegment): boolean {
  if (seg.compression_ratio !== undefined && seg.compression_ratio > COMPRESSION_RATIO_THRESHOLD) {
    return true
  }
  return (
    seg.no_speech_prob !== undefined &&
    seg.avg_logprob !== undefined &&
    seg.no_speech_prob > NO_SPEECH_THRESHOLD &&
    seg.avg_logprob < LOGPROB_THRESHOLD
  )
}

/** Shortest a word may be on screen; shorter looks like a flicker. */
export const MIN_WORD_SEC = 0.05
/** Length given to a word Whisper reported with no duration at all. */
const FILL_WORD_SEC = 0.15

/**
 * Make word timings usable for karaoke captions: sorted, non-overlapping and
 * every word at least `MIN_WORD_SEC` long. Whisper word timestamps are noisy
 * at the edges — a word can start before the previous one ends, or have zero
 * (even negative) length — and the caption generators drop any word whose
 * window is empty, so such a word would never light up. Mutates and returns
 * the array. Pure and exported for tests.
 */
export function normalizeWordTimings(words: TranscriptWord[]): TranscriptWord[] {
  words.sort((a, b) => a.start - b.start)
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const prev = words[i - 1]
    if (prev && word.start < prev.end) word.start = prev.end
    const floor = word.start + MIN_WORD_SEC
    if (word.end < floor) {
      const next = words[i + 1]
      const natural = word.start + FILL_WORD_SEC
      // Grow into the gap before the next word when there is one; otherwise
      // take the minimum and let the next word be nudged along on its turn.
      word.end = next ? (next.start >= floor ? Math.min(natural, next.start) : floor) : natural
    }
  }
  return words
}

/**
 * Merge per-chunk Whisper responses into one transcript with absolute
 * timestamps. Pure and exported for unit tests.
 *
 * - Hallucinated segments (see isHallucinatedSegment) are dropped, along
 *   with the words Whisper placed inside them.
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

    // Spans (chunk-local seconds) of segments judged to be hallucinations;
    // words falling inside them go too.
    const dropped: Array<[number, number]> = []
    for (const seg of res.segments ?? []) {
      if (isHallucinatedSegment(seg)) dropped.push([seg.start, seg.end])
    }
    const inDropped = (localMid: number): boolean =>
      dropped.some(([from, to]) => localMid >= from && localMid <= to)

    for (const w of res.words ?? []) {
      const start = w.start + chunk.offsetSec
      if (!inWindow(start)) continue
      if (dropped.length > 0 && inDropped((w.start + w.end) / 2)) continue
      const text = w.word.trim()
      if (text.length === 0) continue
      pool.push({ text, start, end: w.end + chunk.offsetSec })
    }

    for (const seg of res.segments ?? []) {
      const start = seg.start + chunk.offsetSec
      if (!inWindow(start)) continue
      if (isHallucinatedSegment(seg)) continue
      segments.push({
        id: 0, // renumbered after sorting
        text: seg.text.trim(),
        start,
        end: seg.end + chunk.offsetSec,
        words: []
      })
    }
  }

  normalizeWordTimings(pool)
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
 * Text of a chunk with hallucinated segments removed, for priming the next
 * chunk. Feeding a hallucination back in as the prompt is the classic way
 * Whisper is talked into repeating it for the rest of the file.
 */
export function trustedChunkText(res: WhisperResponse): string {
  const segments = res.segments
  if (!segments || segments.length === 0) return res.text ?? ''
  return segments
    .filter((seg) => !isHallucinatedSegment(seg))
    .map((seg) => seg.text.trim())
    .filter(Boolean)
    .join(' ')
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
    previousTail = trustedChunkText(res).slice(-600)
    results.push({ chunk, res })
    onProgress?.((i + 1) / chunks.length)
  }

  return stitchChunkResults(results)
}
