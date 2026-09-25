/** Provider-neutral evaluation. All times refer to the unedited source. */
export interface TimedSpan { start: number; end: number }
export interface BenchmarkWord extends TimedSpan { text: string }
export interface SpeakerSpan extends TimedSpan { speaker: string }
export interface FocusSpan extends TimedSpan { targets: Array<string | null> }
export interface QualitySample {
  sourceSha256: string
  durationSec: number
  words?: BenchmarkWord[]
  /** Canonical speaker IDs, mapped from each model's arbitrary cluster IDs. Overlap is allowed. */
  speakers?: SpeakerSpan[]
  /** Reference: acceptable visible targets. Prediction: exactly one target; null means wide/fit. */
  focus?: FocusSpan[]
  /** Distinct human-selected moments in the reference; ranked candidates in predictions. */
  highlights?: TimedSpan[]
  runtimeSec?: number
  costUsd?: number
}

const token = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

/** WER alignment and timing errors on correctly matched words, never on guessed timings. */
export function scoreWords(reference: BenchmarkWord[], prediction: BenchmarkWord[]) {
  const ref = reference.filter((w) => token(w.text))
  const pred = prediction.filter((w) => token(w.text))
  const n = ref.length, m = pred.length, width = m + 1
  if ((n + 1) * width > 25_000_000) throw new Error('Word alignment is too large; split this benchmark into shorter cases.')
  const directions = new Uint8Array((n + 1) * width)
  let previous = Uint32Array.from({ length: width }, (_, i) => i)
  for (let j = 1; j <= m; j++) directions[j] = 2
  const rt = ref.map((w) => token(w.text)), pt = pred.map((w) => token(w.text))
  for (let i = 1; i <= n; i++) {
    const row = new Uint32Array(width)
    row[0] = i
    directions[i * width] = 1
    for (let j = 1; j <= m; j++) {
      const diagonal = previous[j - 1] + Number(rt[i - 1] !== pt[j - 1])
      const deletion = previous[j] + 1, insertion = row[j - 1] + 1
      row[j] = Math.min(diagonal, deletion, insertion)
      directions[i * width + j] = row[j] === diagonal ? 0 : row[j] === deletion ? 1 : 2
    }
    previous = row
  }
  let i = n, j = m, substitutions = 0, deletions = 0, insertions = 0, matchedWords = 0
  const errors: number[] = []
  while (i || j) {
    const direction = directions[i * width + j]
    if (direction === 1) { deletions++; i-- }
    else if (direction === 2) { insertions++; j-- }
    else {
      i--; j--
      if (rt[i] !== pt[j]) substitutions++
      else {
        matchedWords++
        errors.push(Math.abs(ref[i].start - pred[j].start), Math.abs(ref[i].end - pred[j].end))
      }
    }
  }
  return {
    referenceWords: n, substitutions, deletions, insertions, matchedWords,
    wordErrorRate: n ? (substitutions + deletions + insertions) / n : null,
    matchedWordFraction: n ? matchedWords / n : null,
    boundaryErrorP50Sec: percentile(errors, 0.5), boundaryErrorP95Sec: percentile(errors, 0.95)
  }
}

function timeline(reference: TimedSpan[], prediction: TimedSpan[], duration: number): number[] {
  return [...new Set([0, duration, ...reference.flatMap((s) => [s.start, s.end]),
    ...prediction.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b)
}

/** Exact interval integration, overlap included, zero collar. IDs must be mapped before scoring. */
export function scoreSpeakers(reference: SpeakerSpan[], prediction: SpeakerSpan[], duration: number) {
  const boundaries = timeline(reference, prediction, duration)
  let referenceSpeakerSec = 0, missedSpeakerSec = 0, falseAlarmSpeakerSec = 0, confusedSpeakerSec = 0
  for (let i = 1; i < boundaries.length; i++) {
    const t = (boundaries[i] + boundaries[i - 1]) / 2, dt = boundaries[i] - boundaries[i - 1]
    const ref = new Set(reference.filter((s) => s.start <= t && t < s.end).map((s) => s.speaker))
    const pred = new Set(prediction.filter((s) => s.start <= t && t < s.end).map((s) => s.speaker))
    const correct = [...ref].filter((s) => pred.has(s)).length
    referenceSpeakerSec += ref.size * dt
    missedSpeakerSec += Math.max(0, ref.size - pred.size) * dt
    falseAlarmSpeakerSec += Math.max(0, pred.size - ref.size) * dt
    confusedSpeakerSec += (Math.min(ref.size, pred.size) - correct) * dt
  }
  return { referenceSpeakerSec, missedSpeakerSec, falseAlarmSpeakerSec, confusedSpeakerSec,
    diarizationErrorRate: referenceSpeakerSec
      ? (missedSpeakerSec + falseAlarmSpeakerSec + confusedSpeakerSec) / referenceSpeakerSec : null }
}

/** Only explicitly annotated visual spans are scored. Missing decisions count as errors. */
export function scoreFocus(reference: FocusSpan[], prediction: FocusSpan[], duration: number) {
  const boundaries = timeline(reference, prediction, duration)
  let labelledSec = 0, wrongTargetSec = 0, missingDecisionSec = 0
  for (let i = 1; i < boundaries.length; i++) {
    const t = (boundaries[i] + boundaries[i - 1]) / 2, dt = boundaries[i] - boundaries[i - 1]
    const ref = reference.find((s) => s.start <= t && t < s.end)
    if (!ref) continue
    const pred = prediction.find((s) => s.start <= t && t < s.end)
    labelledSec += dt
    if (!pred) missingDecisionSec += dt
    if (!pred || !ref.targets.includes(pred.targets[0])) wrongTargetSec += dt
  }
  return { labelledSec, wrongTargetSec, missingDecisionSec,
    wrongTargetRate: labelledSec ? wrongTargetSec / labelledSec : null }
}

export function intervalIoU(a: TimedSpan, b: TimedSpan): number {
  const intersection = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
  return intersection / (a.end - a.start + b.end - b.start - intersection)
}

/** Maximum one-to-one matching prevents duplicates from inflating recall. */
export function scoreHighlights(reference: TimedSpan[], prediction: TimedSpan[], k: number, threshold: number) {
  const selected = prediction.slice(0, k)
  const assigned = new Map<number, number>()
  const match = (candidate: number, visited: Set<number>): boolean => {
    for (let r = 0; r < reference.length; r++) {
      if (visited.has(r) || intervalIoU(selected[candidate], reference[r]) < threshold) continue
      visited.add(r)
      const prior = assigned.get(r)
      if (prior === undefined || match(prior, visited)) { assigned.set(r, candidate); return true }
    }
    return false
  }
  for (let p = 0; p < selected.length; p++) match(p, new Set())
  return { k, iouThreshold: threshold, returned: selected.length, returnedFraction: selected.length / k,
    matchedPerRequestedSlot: assigned.size / k, referenceMoments: reference.length,
    matchedMoments: assigned.size, precision: selected.length ? assigned.size / selected.length : 0,
    recall: reference.length ? assigned.size / reference.length : null }
}

/** Reject malformed/incomparable inputs rather than emitting misleading scores. */
export function validateQualitySample(value: unknown, prediction = false): asserts value is QualitySample {
  if (!value || typeof value !== 'object') throw new Error('Quality sample must be an object')
  const s = value as QualitySample
  if (!/^[a-f0-9]{64}$/i.test(s.sourceSha256)) throw new Error('sourceSha256 must be the SHA-256 of the source video')
  if (!Number.isFinite(s.durationSec) || s.durationSec <= 0) throw new Error('durationSec must be positive')
  for (const field of ['words', 'speakers', 'focus', 'highlights'] as const) {
    const spans = s[field]
    if (spans === undefined) continue
    if (!Array.isArray(spans)) throw new Error(`${field} must be an array`)
    for (const span of spans) {
      if (!span || !Number.isFinite(span.start) || !Number.isFinite(span.end) ||
        span.start < 0 || span.end <= span.start || span.end > s.durationSec + 0.001) {
        throw new Error(`${field}: timestamps must be finite, ordered, and inside the source`)
      }
    }
  }
  if (s.words?.some((w) => typeof w.text !== 'string' || /\s/.test(w.text.trim()))) {
    throw new Error('words must contain one aligned token per item')
  }
  if (s.words?.some((w, i, a) => i > 0 && w.start < a[i - 1].start)) throw new Error('words must be in chronological order')
  if (s.speakers?.some((x) => typeof x.speaker !== 'string' || !x.speaker.trim())) throw new Error('speaker IDs must be nonempty strings')
  if (s.focus) {
    const sorted = [...s.focus].sort((a, b) => a.start - b.start)
    for (let i = 0; i < sorted.length; i++) {
      const span = sorted[i]
      if (!Array.isArray(span.targets) || !span.targets.length || (prediction && span.targets.length !== 1) ||
        span.targets.some((t) => t !== null && (typeof t !== 'string' || !t.trim()))) {
        throw new Error('focus targets must be speaker IDs or null; predictions choose exactly one')
      }
      if (i && span.start < sorted[i - 1].end) throw new Error('focus spans must not overlap')
    }
  }
  for (const field of ['runtimeSec', 'costUsd'] as const) {
    if (s[field] !== undefined && (!Number.isFinite(s[field]) || s[field]! < 0)) throw new Error(`${field} must be nonnegative`)
  }
}

export function evaluateQuality(reference: QualitySample, prediction: QualitySample, k = 5, iouThreshold = 0.5) {
  validateQualitySample(reference)
  validateQualitySample(prediction, true)
  if (!Number.isInteger(k) || k < 1 || !(iouThreshold > 0 && iouThreshold <= 1)) throw new Error('Invalid highlight matching settings')
  if (reference.sourceSha256.toLowerCase() !== prediction.sourceSha256.toLowerCase() ||
    Math.abs(reference.durationSec - prediction.durationSec) > 0.01) throw new Error('Reference and prediction describe different source media')
  return {
    words: reference.words !== undefined && prediction.words !== undefined ? scoreWords(reference.words, prediction.words) : null,
    speakers: reference.speakers !== undefined && prediction.speakers !== undefined
      ? scoreSpeakers(reference.speakers, prediction.speakers, reference.durationSec) : null,
    focus: reference.focus !== undefined && prediction.focus !== undefined
      ? scoreFocus(reference.focus, prediction.focus, reference.durationSec) : null,
    highlights: reference.highlights !== undefined && prediction.highlights !== undefined
      ? scoreHighlights(reference.highlights, prediction.highlights, k, iouThreshold) : null,
    runtimeSec: prediction.runtimeSec ?? null, costUsd: prediction.costUsd ?? null
  }
}
