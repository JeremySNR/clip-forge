import type { Transcript, TranscriptSegment, TranscriptWord } from '@shared/types'

/**
 * Build a transcript from sentences of evenly spaced words. Each sentence
 * becomes one segment; words are `wordSec` long with `gapSec` between them.
 */
export function makeTranscript(
  sentences: string[],
  opts: { startSec?: number; wordSec?: number; gapSec?: number; sentenceGapSec?: number } = {}
): Transcript {
  const wordSec = opts.wordSec ?? 0.3
  const gapSec = opts.gapSec ?? 0.1
  const sentenceGapSec = opts.sentenceGapSec ?? 0.4
  let t = opts.startSec ?? 0
  const segments: TranscriptSegment[] = []
  for (const sentence of sentences) {
    const words: TranscriptWord[] = []
    for (const text of sentence.split(/\s+/).filter(Boolean)) {
      words.push({ text, start: t, end: t + wordSec })
      t += wordSec + gapSec
    }
    segments.push({
      id: segments.length,
      text: sentence,
      start: words[0].start,
      end: words[words.length - 1].end,
      words
    })
    t += sentenceGapSec
  }
  return { language: 'english', durationSec: t, segments }
}
