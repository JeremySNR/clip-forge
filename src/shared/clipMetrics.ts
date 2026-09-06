import type { Transcript } from './types'
import { wordsInRange } from './captionLayout'
import { transcriptSentences, type Sentence } from './sentences'

/**
 * Boundary quality of a clip, measured against the transcript. The project
 * lives or dies by where its clips start and stop, and these are the things
 * a viewer notices in the first and last second: opening mid-thought,
 * cutting a sentence off, or trailing into dead air. Pure functions shared by
 * the eval script and the unit tests.
 */

export interface ClipBoundaryReport {
  durationSec: number
  wordCount: number
  /** Seconds of room before the first word; null when the clip has no words. */
  leadInSec: number | null
  /** Seconds of room after the last word; null when the clip has no words. */
  tailSec: number | null
  /** The first word is not the first word of its sentence. */
  startsMidSentence: boolean | null
  /** The last word is not the last word of its sentence. */
  endsMidSentence: boolean | null
  openingSentence: string | null
  closingSentence: string | null
}

/**
 * Tail room the export needs: its 0.4 s audio fade sits after the last word,
 * so anything shorter ducks speech. Beyond the upper bound the clip trails
 * into dead air the viewer has to sit through.
 */
export const TAIL_MIN_SEC = 0.4
export const TAIL_MAX_SEC = 1.5

function sentenceOfWord(sentences: Sentence[], start: number): Sentence | null {
  for (const s of sentences) {
    if (start < s.start - 1e-6) return null
    if (start <= s.end + 1e-6) return s
  }
  return null
}

export function analyzeClipBoundaries(
  transcript: Transcript,
  start: number,
  end: number,
  sentences: Sentence[] = transcriptSentences(transcript)
): ClipBoundaryReport {
  const words = wordsInRange(transcript, start, end)
  const durationSec = end - start
  if (words.length === 0) {
    return {
      durationSec,
      wordCount: 0,
      leadInSec: null,
      tailSec: null,
      startsMidSentence: null,
      endsMidSentence: null,
      openingSentence: null,
      closingSentence: null
    }
  }
  const first = words[0]
  const last = words[words.length - 1]
  const opening = sentenceOfWord(sentences, first.start)
  const closing = sentenceOfWord(sentences, last.start)
  return {
    durationSec,
    wordCount: words.length,
    leadInSec: first.start - start,
    tailSec: end - last.end,
    startsMidSentence: opening ? opening.words[0] !== first : null,
    endsMidSentence: closing ? closing.words[closing.words.length - 1] !== last : null,
    openingSentence: opening?.text ?? null,
    closingSentence: closing?.text ?? null
  }
}

export interface BoundarySummary {
  clips: number
  /** Clips whose first word is not a sentence start. */
  midSentenceStarts: number
  /** Clips whose last word is not a sentence end. */
  midSentenceEnds: number
  /** Clips with too little tail for the audio fade. */
  clippedTails: number
  /** Clips trailing into dead air. */
  deadAirTails: number
  meanDurationSec: number
  medianDurationSec: number
  minDurationSec: number
  maxDurationSec: number
}

export function summarizeBoundaries(reports: ClipBoundaryReport[]): BoundarySummary {
  const durations = reports.map((r) => r.durationSec).sort((a, b) => a - b)
  const n = reports.length
  const median =
    n === 0 ? 0 : n % 2 === 1 ? durations[(n - 1) / 2] : (durations[n / 2 - 1] + durations[n / 2]) / 2
  return {
    clips: n,
    midSentenceStarts: reports.filter((r) => r.startsMidSentence === true).length,
    midSentenceEnds: reports.filter((r) => r.endsMidSentence === true).length,
    clippedTails: reports.filter((r) => r.tailSec !== null && r.tailSec < TAIL_MIN_SEC).length,
    deadAirTails: reports.filter((r) => r.tailSec !== null && r.tailSec > TAIL_MAX_SEC).length,
    meanDurationSec: n === 0 ? 0 : durations.reduce((a, b) => a + b, 0) / n,
    medianDurationSec: median,
    minDurationSec: n === 0 ? 0 : durations[0],
    maxDurationSec: n === 0 ? 0 : durations[n - 1]
  }
}
