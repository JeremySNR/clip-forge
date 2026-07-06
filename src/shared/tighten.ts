import type { Transcript } from './types'
import { wordsInRange } from './captionLayout'

/**
 * "Tighten cuts": compute which sub-segments of a clip to keep so that long
 * pauses and filler words are removed. Shared by the export renderer (ffmpeg
 * trim+concat) and the live preview (playback skips the removed spans), so
 * both stay in sync.
 */

export interface KeptSegment {
  /** Absolute source-video seconds. */
  start: number
  end: number
}

/** Pause longer than this (between words) gets cut down. */
const MAX_PAUSE_SEC = 0.7
/** Breathing room kept around speech when a pause is trimmed. */
const PRE_ROLL_SEC = 0.18
const POST_ROLL_SEC = 0.3
/** Ignore removals shorter than this — not worth a visible jump cut. */
const MIN_REMOVAL_SEC = 0.35
const MIN_SEGMENT_SEC = 0.25
/**
 * Minimum length of a kept run between two cuts. A dense run of "um"s produces
 * many short kept spans separated by tiny removals; cutting each one makes the
 * clip jitter. When a kept run is shorter than this, we'd rather keep the
 * small removed gap before it than add another jump cut.
 */
const MIN_KEPT_SEC = 1.2
/**
 * …but only bridge a short kept run back over a *small* gap. A genuinely long
 * pause is still worth one clean cut even if the speech after it is short, so
 * removals larger than this are never bridged away.
 */
const BRIDGE_MAX_GAP_SEC = 1.5

const FILLER_WORDS = new Set(['um', 'uh', 'uhm', 'umm', 'erm', 'er', 'ah', 'mmm', 'hmm', 'mhm'])

function isFiller(text: string): boolean {
  return FILLER_WORDS.has(text.toLowerCase().replace(/[^a-z]/g, ''))
}

/**
 * Returns the kept segments for a clip, or null when there is nothing worth
 * cutting (render should then use the simple single-span path).
 */
export function computeKeptSegments(
  transcript: Transcript,
  clipStart: number,
  clipEnd: number
): KeptSegment[] | null {
  const words = wordsInRange(transcript, clipStart, clipEnd).filter((w) => !isFiller(w.text))
  if (words.length < 3) return null

  // Build keep-intervals around each retained word, then merge.
  const intervals: KeptSegment[] = words.map((w) => ({
    start: Math.max(clipStart, w.start - PRE_ROLL_SEC),
    end: Math.min(clipEnd, w.end + POST_ROLL_SEC)
  }))
  const merged: KeptSegment[] = []
  for (const iv of intervals) {
    const last = merged[merged.length - 1]
    // Merge unless the true gap between speech is worth cutting.
    if (last && iv.start - last.end < Math.max(MIN_REMOVAL_SEC, MAX_PAUSE_SEC - PRE_ROLL_SEC - POST_ROLL_SEC)) {
      last.end = Math.max(last.end, iv.end)
    } else {
      merged.push({ ...iv })
    }
  }

  // Anti-jitter: bridge short kept runs back over small removed gaps so dense
  // filler ("word um word uh word") doesn't turn into a burst of jump cuts.
  // Long pauses (gap > BRIDGE_MAX_GAP_SEC) are preserved as single clean cuts.
  const spaced: KeptSegment[] = []
  for (const seg of merged) {
    const prev = spaced[spaced.length - 1]
    const gapToPrev = prev ? seg.start - prev.end : Infinity
    if (prev && seg.end - seg.start < MIN_KEPT_SEC && gapToPrev <= BRIDGE_MAX_GAP_SEC) {
      prev.end = seg.end
    } else {
      spaced.push({ ...seg })
    }
  }

  const kept = spaced.filter((s) => s.end - s.start >= MIN_SEGMENT_SEC)
  if (kept.length === 0) return null

  const keptDuration = kept.reduce((sum, s) => sum + (s.end - s.start), 0)
  const removed = clipEnd - clipStart - keptDuration
  // Nothing meaningful to remove -> keep the untouched clip.
  if (removed < 0.4) return null
  return kept
}

/** Monotonic mapping from source time to the compacted output timeline. */
export class TimeMap {
  private readonly offsets: number[] = []

  constructor(private readonly segments: KeptSegment[]) {
    let acc = 0
    for (const seg of segments) {
      this.offsets.push(acc)
      acc += seg.end - seg.start
    }
  }

  get outputDuration(): number {
    const last = this.segments.length - 1
    return last < 0 ? 0 : this.offsets[last] + (this.segments[last].end - this.segments[last].start)
  }

  /** Map a source time to output time (clamping removed spans to boundaries). */
  toOutput(t: number): number {
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i]
      if (t < seg.start) return this.offsets[i]
      if (t <= seg.end) return this.offsets[i] + (t - seg.start)
    }
    return this.outputDuration
  }

  /** True when the source time falls inside a removed span. */
  isRemoved(t: number): boolean {
    return !this.segments.some((seg) => t >= seg.start && t <= seg.end)
  }

  /** The start of the next kept segment at/after t, or null at the end. */
  nextKeptStart(t: number): number | null {
    for (const seg of this.segments) {
      if (t < seg.start) return seg.start
      if (t <= seg.end) return null
    }
    return null
  }
}

/**
 * Rewrite a transcript into the compacted output timeline (only content
 * within the clip, with word/segment times remapped). Used so the caption
 * generator can run unchanged against the tightened clip.
 */
export function remapTranscript(
  transcript: Transcript,
  map: TimeMap,
  clipStart: number,
  clipEnd: number
): Transcript {
  const segments = transcript.segments
    .filter((seg) => seg.end >= clipStart && seg.start <= clipEnd)
    .map((seg) => ({
      ...seg,
      start: map.toOutput(Math.max(seg.start, clipStart)),
      end: map.toOutput(Math.min(seg.end, clipEnd)),
      words: seg.words
        .filter((w) => {
          const mid = (w.start + w.end) / 2
          return mid >= clipStart && mid <= clipEnd && !map.isRemoved(mid)
        })
        .map((w) => ({ ...w, start: map.toOutput(w.start), end: map.toOutput(w.end) }))
    }))
    .filter((seg) => seg.words.length > 0 || seg.end > seg.start)
  return { ...transcript, segments }
}
