import type { Transcript, TranscriptWord } from './types'

/**
 * Word selection and grouping shared by the ASS generator (main process) and
 * the live caption preview (renderer), so preview and export stay in sync.
 */

export interface WordGroup {
  words: TranscriptWord[]
  start: number
  end: number
}

/** Collect the words spoken inside [clipStart, clipEnd] from the transcript. */
export function wordsInRange(
  transcript: Transcript,
  clipStart: number,
  clipEnd: number
): TranscriptWord[] {
  const out: TranscriptWord[] = []
  for (const seg of transcript.segments) {
    if (seg.end < clipStart || seg.start > clipEnd) continue
    for (const w of seg.words) {
      const mid = (w.start + w.end) / 2
      if (mid >= clipStart && mid <= clipEnd && w.text.length > 0) out.push(w)
    }
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

const MAX_PAUSE_IN_GROUP_SEC = 0.9

export function groupWords(words: TranscriptWord[], wordsPerGroup: number): WordGroup[] {
  const groups: WordGroup[] = []
  let current: TranscriptWord[] = []
  const flush = (): void => {
    if (current.length === 0) return
    groups.push({
      words: current,
      start: current[0].start,
      end: current[current.length - 1].end
    })
    current = []
  }
  for (const w of words) {
    const prev = current[current.length - 1]
    const endsSentence = prev ? /[.!?]$/.test(prev.text) : false
    if (
      current.length >= wordsPerGroup ||
      (prev && w.start - prev.end > MAX_PAUSE_IN_GROUP_SEC) ||
      endsSentence
    ) {
      flush()
    }
    current.push(w)
  }
  flush()
  return groups
}
