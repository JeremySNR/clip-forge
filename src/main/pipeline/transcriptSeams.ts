import type { Transcript, TranscriptSegment, TranscriptWord } from '@shared/types'

const ANCHOR_WORDS = 3
const ANCHOR_MIN_DISTANCE = 4
const ANCHOR_MAX_DISTANCE = 16
const MAX_ANCHOR_DRIFT = 1

function token(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

interface Anchor { original: number; patch: number; distance: number }

/** Match actual word sequences on both sides, rather than cutting two ASR
 * responses at an arbitrary timestamp (which can omit or duplicate a word). */
function anchors(
  original: TranscriptWord[], patch: TranscriptWord[], seam: number, side: 'left' | 'right'
): Anchor[] {
  const matches: Anchor[] = []
  for (let i = 0; i <= original.length - ANCHOR_WORDS; i++) {
    const first = original[i], last = original[i + ANCHOR_WORDS - 1]
    const distance = side === 'left' ? seam - last.end : first.start - seam
    if (distance < ANCHOR_MIN_DISTANCE || distance > ANCHOR_MAX_DISTANCE) continue
    if (last.end - first.start > 4) continue
    const sequence = original.slice(i, i + ANCHOR_WORDS).map(w => token(w.text))
    if (sequence.some(t => !t) || new Set(sequence).size < 2) continue
    for (let j = 0; j <= patch.length - ANCHOR_WORDS; j++) {
      if (sequence.some((t, k) => t !== token(patch[j + k].text))) continue
      if (Math.abs(first.start - patch[j].start) > MAX_ANCHOR_DRIFT ||
          Math.abs(last.end - patch[j + ANCHOR_WORDS - 1].end) > MAX_ANCHOR_DRIFT) continue
      matches.push({ original: i, patch: j, distance })
    }
  }
  return matches.sort((a, b) => a.distance - b.distance)
}

/** Re-decode only joins with sustained disagreement. In particular, a new
 * chunk can omit its opening speech even though the previous chunk heard it.
 * Single-word recognition differences do not justify replacing a good join. */
export function needsSeamRepair(left: Transcript, right: Transcript, seam: number): boolean {
  const leftWords = left.segments.flatMap(s => s.words)
  const rightWords = right.segments.flatMap(s => s.words)
  const missingRun = (words: TranscriptWord[], other: TranscriptWord[]): boolean => {
    let missing: string[] = []
    for (const word of words) {
      const key = token(word.text)
      if (!key) continue
      const match = other.some(w => token(w.text) === key && Math.abs(w.start - word.start) <= 1.25)
      if (match) missing = []
      else missing.push(key)
      if (missing.length >= 3 && new Set(missing).size >= 2) return true
    }
    return false
  }
  return missingRun(leftWords.filter(w => w.start >= seam && w.start < seam + 4), rightWords) ||
    missingRun(rightWords.filter(w => w.start >= seam - 4 && w.start < seam), leftWords)
}

export interface SeamRepair {
  transcript: Transcript
  applied: boolean
  reason: string
  replacedWords?: number
  replacementWords?: number
  from?: number
  to?: number
}

/** Apply a fresh audio decode only between matching, time-consistent anchors.
 * Patch timestamps must already be in source time. Failure preserves the input.
 * This repairs stitching omissions; it does not establish ASR correctness. */
export function repairTranscriptSeam(transcript: Transcript, patch: Transcript, seam: number): SeamRepair {
  const original = transcript.segments.flatMap(s => s.words)
  const replacement = patch.segments.flatMap(s => s.words)
  const valid = (words: TranscriptWord[]): boolean => words.every((w, i) =>
    Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start &&
    (i === 0 || w.start >= words[i - 1].start))
  const reject = (reason: string): SeamRepair => ({ transcript, applied: false, reason })
  if (!Number.isFinite(seam) || !valid(original) || !valid(replacement)) return reject('Invalid word timings')
  const leftCandidates = anchors(original, replacement, seam, 'left')
  const rightCandidates = anchors(original, replacement, seam, 'right')
  if (!leftCandidates.length || !rightCandidates.length) return reject('No matching word anchors on both sides')
  const candidates = leftCandidates.flatMap(left => rightCandidates.map(right => ({ left, right })))
    .sort((a, b) => a.left.distance + a.right.distance - b.left.distance - b.right.distance)
  const choice = candidates.find(({left, right}) => {
    const first = replacement[left.patch + ANCHOR_WORDS], last = replacement[right.patch - 1]
    const before = original[left.original + ANCHOR_WORDS - 1], after = original[right.original]
    return left.original + ANCHOR_WORDS < right.original && left.patch + ANCHOR_WORDS < right.patch &&
      first.start >= before.end - 0.15 && last.end <= after.start + 0.15
  })
  if (!choice) return reject('Repair timing conflicts with surrounding speech')
  const { left, right } = choice
  const fromIndex = left.original + ANCHOR_WORDS
  const toIndex = right.original
  const patchFrom = left.patch + ANCHOR_WORDS
  const patchTo = right.patch
  if (fromIndex >= toIndex || patchFrom >= patchTo) return reject('Empty or reversed repair interval')
  const first = replacement[patchFrom], last = replacement[patchTo - 1]
  const before = original[fromIndex - 1], after = original[toIndex]
  // An alignment mismatch must not push surrounding speech to make room.
  if (first.start < before.end - 0.15 || last.end > after.start + 0.15) {
    return reject('Repair timing conflicts with surrounding speech')
  }
  const retainedBefore = new Set(original.slice(0, fromIndex))
  const retainedAfter = new Set(original.slice(toIndex))
  const inserted = new Set(replacement.slice(patchFrom, patchTo))
  const select = (segments: TranscriptSegment[], keep: Set<TranscriptWord>): TranscriptSegment[] =>
    segments.flatMap(s => {
      const words = s.words.filter(w => keep.has(w)).map(w => ({ ...w }))
      if (!words.length) return []
      return [{ ...s, start: words[0].start, end: words[words.length - 1].end,
        text: words.length === s.words.length ? s.text : words.map(w => w.text).join(' '), words }]
    })
  const middle = select(patch.segments, inserted)
  // Small differences at anchor edges are bounded to their existing neighbors.
  middle[0].words[0].start = Math.max(first.start, before.end)
  const tail = middle[middle.length - 1]
  tail.words[tail.words.length - 1].end = Math.min(last.end, after.start)
  const segments = [
    ...select(transcript.segments, retainedBefore), ...middle,
    ...select(transcript.segments, retainedAfter)
  ]
  if (!valid(segments.flatMap(s => s.words))) return reject('Repair leaves an empty word')
  segments.forEach((s, id) => {
    s.id = id
    s.start = s.words[0].start
    s.end = s.words[s.words.length - 1].end
  })
  return { transcript: { ...transcript, segments }, applied: true,
    reason: 'Replaced join with audio decode between matching word anchors',
    replacedWords: toIndex - fromIndex, replacementWords: patchTo - patchFrom,
    from: before.end, to: after.start }
}
