import type { Transcript, TranscriptWord } from './types'
import { wordsInRange } from './captionLayout'

/**
 * The sentence model of a transcript. Whisper's segments break wherever its
 * decoder window happened to end — routinely mid-sentence — so anything that
 * reasons about where a thought starts or stops (clip boundaries, the LLM's
 * view of the transcript, the ending and opening reviews) works on sentences
 * derived from word punctuation instead.
 */

/** True when spoken text ends a sentence (terminal punctuation). */
export function endsSentence(text: string): boolean {
  return /[.!?]["']?$/.test(text.trim())
}

export interface Sentence {
  /** Position in the transcript, 0-based. */
  index: number
  /** First word's start, in source seconds. */
  start: number
  /** Last word's end, in source seconds. */
  end: number
  text: string
  words: TranscriptWord[]
  /**
   * Duration-weighted mean of the vocal energy of the Whisper segments the
   * sentence spans (0..1 percentile); undefined when none were annotated.
   */
  energy?: number
}

/**
 * A run of speech with no terminal punctuation for longer than this is not
 * one sentence, whatever Whisper says — it is a speaker who does not pause
 * for full stops, or a transcription that dropped them. Such runs are split
 * at their longest pauses so they still offer clip boundaries.
 */
export const MAX_SENTENCE_SEC = 20
/** Pauses shorter than this are not breath points worth splitting at. */
const MIN_SPLIT_PAUSE_SEC = 0.3
/** Neither half of a split may be shorter than this. */
const MIN_SPLIT_HALF_SEC = 2

interface TaggedWord {
  word: TranscriptWord
  energy?: number
  endsHere: boolean
}

/** Split an over-long run at its longest pause, recursively. */
function splitLongRun(run: TaggedWord[]): TaggedWord[][] {
  const span = run[run.length - 1].word.end - run[0].word.start
  if (span <= MAX_SENTENCE_SEC || run.length < 4) return [run]
  let bestIndex = -1
  let bestGap = MIN_SPLIT_PAUSE_SEC
  for (let i = 1; i < run.length; i++) {
    const gap = run[i].word.start - run[i - 1].word.end
    const leftSpan = run[i - 1].word.end - run[0].word.start
    const rightSpan = run[run.length - 1].word.end - run[i].word.start
    if (gap > bestGap && leftSpan >= MIN_SPLIT_HALF_SEC && rightSpan >= MIN_SPLIT_HALF_SEC) {
      bestGap = gap
      bestIndex = i
    }
  }
  if (bestIndex === -1) return [run]
  return [...splitLongRun(run.slice(0, bestIndex)), ...splitLongRun(run.slice(bestIndex))]
}

function toSentence(run: TaggedWord[], index: number): Sentence {
  const words = run.map((t) => t.word)
  let energySum = 0
  let energyWeight = 0
  for (const t of run) {
    if (t.energy === undefined) continue
    const weight = Math.max(0.01, t.word.end - t.word.start)
    energySum += t.energy * weight
    energyWeight += weight
  }
  return {
    index,
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((w) => w.text).join(' '),
    words,
    energy: energyWeight > 0 ? Math.round((energySum / energyWeight) * 100) / 100 : undefined
  }
}

/**
 * Sentences of a transcript, in order. A sentence ends on a word with
 * terminal punctuation — or on a Whisper segment's last word when the segment
 * text carries the punctuation the word lost, which Whisper does now and
 * then. Runs longer than MAX_SENTENCE_SEC are split at their longest pauses.
 * Words cleared in the transcript editor (empty text) are skipped.
 */
export function transcriptSentences(transcript: Transcript): Sentence[] {
  const tagged: TaggedWord[] = []
  for (const seg of transcript.segments) {
    const words = seg.words.filter((w) => w.text.length > 0)
    const segmentEnds = endsSentence(seg.text)
    words.forEach((word, i) => {
      const last = i === words.length - 1
      tagged.push({
        word,
        energy: seg.energy,
        endsHere: endsSentence(word.text) || (last && segmentEnds)
      })
    })
  }
  tagged.sort((a, b) => a.word.start - b.word.start)

  const runs: TaggedWord[][] = []
  let current: TaggedWord[] = []
  for (const t of tagged) {
    current.push(t)
    if (t.endsHere) {
      runs.push(current)
      current = []
    }
  }
  if (current.length > 0) runs.push(current)

  const split: TaggedWord[][] = []
  for (const run of runs) split.push(...splitLongRun(run))
  return split.map((run, index) => toSentence(run, index))
}

/** The sentence a moment falls inside (start <= t < end), or null between sentences. */
export function sentenceAt(sentences: Sentence[], t: number): Sentence | null {
  for (const s of sentences) {
    if (t < s.start) return null
    if (t < s.end) return s
  }
  return null
}

/** Sentences that overlap [from, to], in order. */
export function sentencesInRange(sentences: Sentence[], from: number, to: number): Sentence[] {
  return sentences.filter((s) => s.end > from && s.start < to)
}

/**
 * Timestamps where a sentence finishes, derived from word punctuation rather
 * than Whisper segment boundaries (segments often break mid-sentence).
 */
export function sentenceEndTimes(transcript: Transcript): number[] {
  return [...new Set(transcriptSentences(transcript).map((s) => s.end))].sort((a, b) => a - b)
}

/**
 * Timestamps where a sentence begins: the first word of the transcript and
 * the first word after any sentence-ending word. Used to snap a clip start
 * onto a clean opening so clips never begin mid-thought, and to let the
 * hook-first start review move the start to a later sentence.
 */
export function sentenceStartTimes(transcript: Transcript): number[] {
  return [...new Set(transcriptSentences(transcript).map((s) => s.start))].sort((a, b) => a - b)
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
