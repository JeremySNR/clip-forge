import type { Transcript, TranscriptWord } from './types'
import { wordsInRange } from './captionLayout'

/** True when spoken text ends a sentence (terminal punctuation). */
export function endsSentence(text: string): boolean {
  return /[.!?]["']?$/.test(text.trim())
}

/**
 * Timestamps where a sentence finishes, derived from word punctuation rather
 * than Whisper segment boundaries (segments often break mid-sentence).
 */
export function sentenceEndTimes(transcript: Transcript): number[] {
  const ends: number[] = []
  for (const seg of transcript.segments) {
    for (const w of seg.words) {
      if (endsSentence(w.text)) ends.push(w.end)
    }
    // Whisper sometimes omits terminal punctuation on the last word but keeps
    // it on the segment text.
    const last = seg.words[seg.words.length - 1]
    if (last && !endsSentence(last.text) && endsSentence(seg.text)) {
      ends.push(last.end)
    }
  }
  return [...new Set(ends)].sort((a, b) => a - b)
}

export interface NormalizeClipEndOptions {
  postRollSec?: number
  /** How far the end may move forward to reach a sentence boundary. */
  maxExtendSec?: number
}

/**
 * Move a clip end forward when needed so the last spoken word completes a
 * sentence. Returns the input end unchanged when already on a sentence end or
 * when no punctuated end exists within the extension cap.
 */
export function normalizeClipEnd(
  clipStart: number,
  clipEnd: number,
  transcript: Transcript,
  videoDurationSec: number,
  opts: NormalizeClipEndOptions = {}
): number {
  const postRollSec = opts.postRollSec ?? 0.6
  const maxExtendSec = opts.maxExtendSec ?? 45
  const words = wordsInRange(transcript, clipStart, clipEnd)
  if (words.length === 0) return clipEnd

  const lastWord = words[words.length - 1]
  if (endsSentence(lastWord.text)) {
    const snapped = Math.min(videoDurationSec, lastWord.end + postRollSec)
    return snapped >= clipStart + 1 ? snapped : clipEnd
  }

  const sentenceEnds = sentenceEndTimes(transcript)
  const next = sentenceEnds.find((t) => t >= lastWord.end - 0.05)
  if (!next || next - clipEnd > maxExtendSec) return clipEnd

  const normalized = Math.min(videoDurationSec, next + postRollSec)
  return normalized >= clipStart + 1 ? normalized : clipEnd
}

/** Last spoken word whose midpoint falls inside [clipStart, clipEnd]. */
export function lastWordInClip(
  transcript: Transcript,
  clipStart: number,
  clipEnd: number
): TranscriptWord | null {
  const words = wordsInRange(transcript, clipStart, clipEnd)
  return words.length > 0 ? words[words.length - 1] : null
}
