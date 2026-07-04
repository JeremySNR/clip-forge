import type { Transcript, TranscriptSegment, TranscriptWord } from '@shared/types'
import { transcribeAudioFile } from './openai'

/**
 * Transcribe a set of audio chunks and stitch them into a single transcript
 * with absolute timestamps (each chunk's word/segment times are relative to
 * the chunk start, so we add the chunk offset back). The tail of each chunk's
 * text is passed to the next chunk as a Whisper prompt so terminology and
 * style stay consistent across chunk boundaries.
 */
export async function transcribeChunks(
  apiKey: string,
  model: string,
  chunks: Array<{ path: string; offsetSec: number }>,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<Transcript> {
  const segments: TranscriptSegment[] = []
  let language = 'english'
  let duration = 0
  let nextId = 0
  let previousTail = ''

  for (let i = 0; i < chunks.length; i++) {
    signal?.throwIfAborted()
    const chunk = chunks[i]
    const res = await transcribeAudioFile(apiKey, chunk.path, model, {
      contextPrompt: previousTail || undefined,
      signal
    })
    language = res.language ?? language
    duration = Math.max(duration, chunk.offsetSec + (res.duration ?? 0))
    previousTail = (res.text ?? '').slice(-600)

    const words: TranscriptWord[] = (res.words ?? []).map((w) => ({
      text: w.word.trim(),
      start: w.start + chunk.offsetSec,
      end: w.end + chunk.offsetSec
    }))

    for (const seg of res.segments ?? []) {
      const start = seg.start + chunk.offsetSec
      const end = seg.end + chunk.offsetSec
      segments.push({
        id: nextId++,
        text: seg.text.trim(),
        start,
        end,
        // Small epsilon so words exactly on a boundary land in one segment.
        words: words.filter((w) => w.start >= start - 0.01 && w.start < end - 0.001)
      })
    }
    onProgress?.((i + 1) / chunks.length)
  }

  return { language, durationSec: duration, segments }
}
