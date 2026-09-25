/** Human evaluation of frozen exports. No inferred ratings, engagement claims, or model calls. */
export const reviewDimensions = ['hook', 'coherence', 'payoff', 'speakerChoice', 'framing', 'captions', 'audio', 'overall'] as const
export const severeDefects = ['changed-meaning', 'missing-payoff', 'wrong-speaker', 'hidden-content', 'damaged-speech', 'caption-error', 'other'] as const
export type SevereDefect = typeof severeDefects[number]
export interface ReviewCase {
  id: string
  split: 'development' | 'test'
  tags: string[]
  sourceSha256: string
  /** Same creator and recording setup must remain on one side of the split. */
  creatorGroup?: string
  recordingGroup?: string
}
export interface ReviewSlot {
  id: string
  runId: string
  caseId: string
  rank: number
  status: 'rendered' | 'missing-render' | 'not-returned' | 'unknown-output'
  declaredReady?: boolean
}
export interface ReviewIndex {
  schemaVersion: 2
  experimentId: string
  topK: number
  minimumReviewers: number
  cases: ReviewCase[]
  runs: string[]
  slots: ReviewSlot[]
}
export interface ClipRating {
  id: string
  verdict: 'publishable' | 'repairable' | 'reject'
  /** Measured time only. null means not timed, never zero. */
  repairSeconds: number | null
  sourceCompared: boolean
  severeDefects: SevereDefect[]
  scores: Record<typeof reviewDimensions[number], number | null>
  notes: string
}
export interface ReviewSubmission {
  schemaVersion: 2
  experimentId: string
  reviewer: string
  ratings: ClipRating[]
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const nonempty = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const positiveInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const ratio = (n: number, d: number): number | null => d ? n / d : null
const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Byte-identical media, creators and recording setups cannot leak across splits. */
export function validateReviewCases(cases: ReviewCase[]): { groupingComplete: boolean; warnings: string[] } {
  if (!Array.isArray(cases) || !cases.length) throw new Error('Review cases must be a nonempty array')
  const ids = new Set<string>()
  const groups = new Map<string, string>()
  for (const c of cases) {
    if (!object(c) || !nonempty(c.id) || ids.has(c.id)) throw new Error('Review cases need unique, nonempty IDs')
    ids.add(c.id)
    if (!['development', 'test'].includes(c.split) || !Array.isArray(c.tags) || c.tags.some((t) => !nonempty(t)) ||
      typeof c.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(c.sourceSha256)) throw new Error(`${c.id}: invalid split, tags or source hash`)
    for (const field of ['creatorGroup', 'recordingGroup'] as const) {
      if (c[field] !== undefined && (!nonempty(c[field]) || c[field] !== c[field]!.trim())) throw new Error(`${c.id}: ${field} must be nonempty`)
    }
    for (const [field, group] of [['source', c.sourceSha256.toLowerCase()], ['creator', c.creatorGroup], ['recording', c.recordingGroup]]) {
      if (!group) continue
      const key = `${field}:${group}`, previous = groups.get(key)
      if (previous && previous !== c.split) throw new Error(`${c.id}: ${field} group crosses development/test splits`)
      groups.set(key, c.split)
    }
  }
  const missing = cases.filter((c) => !c.creatorGroup || !c.recordingGroup)
  return { groupingComplete: !missing.length, warnings: missing.length
    ? [`Creator/recording groups missing for ${missing.length} case(s); creator-independent holdout is NOT verified.`] : [] }
}

export function validateReviewIndex(value: unknown): asserts value is ReviewIndex {
  if (!object(value) || value.schemaVersion !== 2 || !nonempty(value.experimentId) || !positiveInteger(value.topK) ||
    !positiveInteger(value.minimumReviewers) || value.minimumReviewers < 2) throw new Error('Invalid review index or minimumReviewers (must be at least two)')
  const index = value as unknown as ReviewIndex
  validateReviewCases(index.cases)
  if (!Array.isArray(index.runs) || !index.runs.length || index.runs.some((r) => !nonempty(r)) ||
    new Set(index.runs).size !== index.runs.length || !Array.isArray(index.slots)) throw new Error('Invalid review runs or slots')
  const caseIds = new Set(index.cases.map((c) => c.id)), ids = new Set<string>(), positions = new Set<string>()
  for (const slot of index.slots) {
    if (!object(slot) || !nonempty(slot.id) || ids.has(slot.id) || !index.runs.includes(slot.runId) || !caseIds.has(slot.caseId) ||
      !positiveInteger(slot.rank) || slot.rank > index.topK ||
      !['rendered', 'missing-render', 'not-returned', 'unknown-output'].includes(slot.status) ||
      (slot.declaredReady !== undefined && typeof slot.declaredReady !== 'boolean')) throw new Error('Invalid or duplicate review slot')
    const position = JSON.stringify([slot.runId, slot.caseId, slot.rank])
    if (positions.has(position)) throw new Error('Duplicate run/case/rank review slot')
    positions.add(position); ids.add(slot.id)
  }
  if (index.slots.length !== index.runs.length * index.cases.length * index.topK) throw new Error('Review index must retain every run/case/top-K slot')
}

export function validateReviewSubmission(value: unknown, index: ReviewIndex): asserts value is ReviewSubmission {
  if (!object(value) || value.schemaVersion !== 2) throw new Error('Ratings must use schemaVersion 2; legacy 1–5 forms need the new verdict and repair fields')
  if (value.experimentId !== index.experimentId) throw new Error('Ratings belong to a different experiment')
  if (!nonempty(value.reviewer) || value.reviewer !== value.reviewer.trim() || !Array.isArray(value.ratings)) throw new Error('Ratings need a trimmed reviewer ID and ratings array')
  const rendered = new Set(index.slots.filter((s) => s.status === 'rendered').map((s) => s.id)), seen = new Set<string>()
  for (const rating of value.ratings) {
    if (!object(rating) || !nonempty(rating.id) || !rendered.has(rating.id)) throw new Error('Rating refers to an unknown or unavailable render')
    if (seen.has(rating.id)) throw new Error('Duplicate clip rating in submission')
    seen.add(rating.id)
    if (!['publishable', 'repairable', 'reject'].includes(rating.verdict as string)) throw new Error('Each rating needs a publishable/repairable/reject verdict')
    if (rating.repairSeconds !== null && (typeof rating.repairSeconds !== 'number' || !Number.isFinite(rating.repairSeconds) || rating.repairSeconds < 0)) {
      throw new Error('repairSeconds must be a measured nonnegative number or null')
    }
    if (rating.verdict === 'reject' && rating.repairSeconds !== null) throw new Error('Rejected clips cannot have accepted-clip repair timing')
    if (rating.verdict === 'publishable' && rating.repairSeconds !== null && rating.repairSeconds !== 0) throw new Error('Publishable as-is clips have zero repair time, or null if not measured')
    if (typeof rating.sourceCompared !== 'boolean' || typeof rating.notes !== 'string') throw new Error('Ratings need sourceCompared and notes')
    if (!Array.isArray(rating.severeDefects) || rating.severeDefects.some((d) => !severeDefects.includes(d)) ||
      new Set(rating.severeDefects).size !== rating.severeDefects.length) throw new Error('Invalid or duplicate severe defect')
    if (rating.verdict === 'publishable' && rating.severeDefects.length) throw new Error('A clip with a severe defect cannot be publishable as-is')
    if (!object(rating.scores) || reviewDimensions.some((d) => {
      const score = (rating.scores as Record<string, unknown>)[d]
      return score !== null && !(typeof score === 'number' && Number.isInteger(score) && score >= 1 && score <= 5)
    }) || rating.scores.overall === null) throw new Error('Scores must contain every dimension (1–5 or null), with a rated overall score')
  }
}

interface ReviewedSlot extends ReviewSlot {
  reviewers: number
  fullyReviewed: boolean
  verdicts: Record<ClipRating['verdict'], number>
  publishable: boolean
  accepted: boolean
  sourceComparedReviewers: number
  defects: SevereDefect[]
  disagreement: boolean
  measuredRepairReviewers: number
  medianRepairSeconds: number | null
  scores: Record<typeof reviewDimensions[number], { mean: number | null; count: number }>
}

function summarizeSlots(slots: ReviewedSlot[]) {
  const count = (predicate: (s: ReviewedSlot) => boolean) => slots.filter(predicate).length
  const returned = count((s) => s.status === 'rendered' || s.status === 'missing-render')
  const reviewed = count((s) => s.fullyReviewed), rated = count((s) => s.reviewers > 0)
  const publishable = count((s) => s.publishable), accepted = count((s) => s.accepted)
  const severe = count((s) => s.defects.length > 0), ready = slots.filter((s) => s.declaredReady === true)
  const timed = slots.filter((s) => s.accepted && s.medianRepairSeconds !== null)
  return {
    eligibleTopKSlots: slots.length, returned, missingOutputSlots: count((s) => s.status === 'not-returned'),
    unknownOutputSlots: count((s) => s.status === 'unknown-output'),
    rendered: count((s) => s.status === 'rendered'), missingRenders: count((s) => s.status === 'missing-render'),
    rated, fullyReviewed: reviewed, reviewedReturnedCoverage: ratio(reviewed, returned), reviewedSlotCoverage: ratio(reviewed, slots.length),
    publishable, publishableAmongReviewed: ratio(publishable, reviewed),
    /** Conservative observed yield: unresolved slots never count as successes. */
    publishablePerTopKSlot: ratio(publishable, slots.length), accepted,
    severeDefectClips: severe, severeDefectRateAmongRated: ratio(severe, rated),
    severeDefects: Object.fromEntries(severeDefects.map((d) => [d, count((s) => s.defects.includes(d))])),
    disagreements: count((s) => s.disagreement),
    sourceComparedClips: count((s) => s.fullyReviewed && s.sourceComparedReviewers === s.reviewers),
    measuredRepairClips: timed.length, repairMeasurementCoverage: ratio(timed.length, accepted),
    medianRepairSeconds: median(timed.map((s) => s.medianRepairSeconds!)),
    readyDeclared: ready.length, readyFullyReviewed: ready.filter((s) => s.fullyReviewed).length,
    readyPublishable: ready.filter((s) => s.publishable).length,
    readyPublishableAmongReviewed: ratio(ready.filter((s) => s.publishable).length, ready.filter((s) => s.fullyReviewed).length),
    readyPublishablePerDeclaredSlot: ratio(ready.filter((s) => s.publishable).length, ready.length)
  }
}

/** Deterministic cluster bootstrap: all clips/cases of a source travel together. */
function sourceInterval(sources: Array<{ successes: number; slots: number }>) {
  if (sources.length < 2) return null
  let seed = 0x43555441
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const samples: number[] = []
  for (let b = 0; b < 2000; b++) {
    let successes = 0, slots = 0
    for (let i = 0; i < sources.length; i++) {
      const source = sources[Math.floor(random() * sources.length)]
      successes += source.successes; slots += source.slots
    }
    samples.push(successes / slots)
  }
  samples.sort((a, b) => a - b)
  return { low: samples[49], high: samples[1949], confidence: 0.95, replicates: 2000, sourceCount: sources.length,
    method: 'percentile bootstrap by source SHA-256; observed publishable/top-K yield; missing reviews are unresolved, not quality failures' }
}

export function aggregateQualityReviews(index: ReviewIndex, values: unknown[]) {
  validateReviewIndex(index)
  const submissions: ReviewSubmission[] = [], reviewers = new Set<string>()
  for (const value of values) {
    validateReviewSubmission(value, index)
    // A reviewer exports one complete file. Reject duplicates instead of choosing an arbitrary revision.
    if (reviewers.has(value.reviewer)) throw new Error(`Duplicate reviewer submission: ${value.reviewer}`)
    reviewers.add(value.reviewer)
    submissions.push({ ...value, ratings: [...value.ratings].sort((a, b) => a.id.localeCompare(b.id)) })
  }
  submissions.sort((a, b) => a.reviewer.localeCompare(b.reviewer))
  const ratings = new Map<string, ClipRating[]>()
  for (const submission of submissions) for (const rating of submission.ratings) {
    ratings.set(rating.id, [...(ratings.get(rating.id) ?? []), rating])
  }
  const slots: ReviewedSlot[] = [...index.slots].sort((a, b) => a.runId.localeCompare(b.runId) || a.caseId.localeCompare(b.caseId) || a.rank - b.rank).map((slot) => {
    const votes = ratings.get(slot.id) ?? [], fullyReviewed = votes.length >= index.minimumReviewers
    const defects = severeDefects.filter((d) => votes.some((v) => v.severeDefects.includes(d)))
    const accepted = fullyReviewed && votes.every((v) => v.verdict !== 'reject')
    const repairTimes = votes.flatMap((v) => v.repairSeconds === null ? [] : [v.repairSeconds])
    return { ...slot, reviewers: votes.length, fullyReviewed,
      verdicts: { publishable: votes.filter((v) => v.verdict === 'publishable').length,
        repairable: votes.filter((v) => v.verdict === 'repairable').length, reject: votes.filter((v) => v.verdict === 'reject').length },
      publishable: fullyReviewed && votes.every((v) => v.verdict === 'publishable') && !defects.length, accepted,
      sourceComparedReviewers: votes.filter((v) => v.sourceCompared).length, defects,
      disagreement: new Set(votes.map((v) => v.verdict)).size > 1 ||
        new Set(votes.map((v) => [...v.severeDefects].sort().join(','))).size > 1,
      measuredRepairReviewers: repairTimes.length,
      medianRepairSeconds: accepted && repairTimes.length >= index.minimumReviewers ? median(repairTimes) : null,
      scores: Object.fromEntries(reviewDimensions.map((d) => {
        const scored = votes.flatMap((v) => v.scores[d] === null ? [] : [v.scores[d]!])
        return [d, { mean: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null, count: scored.length }]
      })) as ReviewedSlot['scores'] }
  })
  const runs = [...index.runs].sort().map((runId) => {
    const runSlots = slots.filter((s) => s.runId === runId)
    const cases = [...index.cases].sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({ ...c,
      metrics: summarizeSlots(runSlots.filter((s) => s.caseId === c.id)) }))
    const summarizeCases = (selected: typeof cases) => {
      const ids = new Set(selected.map((c) => c.id))
      const selectedSlots = runSlots.filter((s) => ids.has(s.caseId))
      const sources = [...new Set(selected.map((c) => c.sourceSha256.toLowerCase()))].sort().map((hash) => {
        const sourceCases = selected.filter((c) => c.sourceSha256.toLowerCase() === hash)
        return { successes: sourceCases.reduce((n, c) => n + c.metrics.publishable, 0),
          slots: sourceCases.reduce((n, c) => n + c.metrics.eligibleTopKSlots, 0) }
      })
      return { ...summarizeSlots(selectedSlots), sourceCount: sources.length,
        publishableYieldSourceInterval95: sourceInterval(sources) }
    }
    return { runId, summary: summarizeCases(cases),
      splits: Object.fromEntries(['development', 'test'].map((split) => [split, summarizeCases(cases.filter((c) => c.split === split))])),
      tags: Object.fromEntries([...new Set(cases.flatMap((c) => c.tags))].sort().map((tag) => [tag, summarizeCases(cases.filter((c) => c.tags.includes(tag)))])), cases }
  })
  return { schemaVersion: 2, experimentId: index.experimentId, topK: index.topK, minimumReviewers: index.minimumReviewers,
    reviewers: [...reviewers].sort(), splitIntegrity: validateReviewCases(index.cases),
    protocol: { consensus: 'At least minimumReviewers independent reviewers; publishable requires unanimous publishable verdicts and no severe defects. Disagreements remain visible.',
      denominator: 'Every run, case and top-K slot is retained. Yield includes missing outputs and unresolved reviews; conditional reviewed quality must be read alongside coverage.',
      repair: 'Median of per-clip median measured seconds for accepted clips timed by at least minimumReviewers; null means unavailable.',
      uncertainty: 'Source-cluster intervals describe observed yield, not engagement. Fewer than two sources returns null; shared creators may still correlate across sources.',
      blinding: 'Reviewer independence and successful blinding must be established by the study coordinator; IDs alone cannot prove them.' },
    runs, slots, submissions }
}
