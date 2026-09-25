import { describe, expect, it } from 'vitest'
import { aggregateQualityReviews, reviewDimensions, validateReviewCases, validateReviewIndex,
  validateReviewSubmission, type ClipRating, type ReviewCase, type ReviewIndex, type ReviewSubmission } from '@shared/qualityReview'

const source = (id: string, hash: string): ReviewCase => ({ id, sourceSha256: hash.repeat(64), split: 'test', tags: ['interview'],
  creatorGroup: id, recordingGroup: id })
const index = (): ReviewIndex => ({ schemaVersion: 2, experimentId: 'frozen-experiment', topK: 3, minimumReviewers: 2,
  cases: [source('a', 'a'), source('b', 'b')], runs: ['baseline'],
  slots: [
    { id: 'a1', runId: 'baseline', caseId: 'a', rank: 1, status: 'rendered', declaredReady: true },
    { id: 'a2', runId: 'baseline', caseId: 'a', rank: 2, status: 'missing-render' },
    { id: 'a3', runId: 'baseline', caseId: 'a', rank: 3, status: 'not-returned' },
    { id: 'b1', runId: 'baseline', caseId: 'b', rank: 1, status: 'rendered' },
    { id: 'b2', runId: 'baseline', caseId: 'b', rank: 2, status: 'rendered' },
    { id: 'b3', runId: 'baseline', caseId: 'b', rank: 3, status: 'unknown-output' }
  ] })
const rating = (id: string, patch: Partial<ClipRating> = {}): ClipRating => ({ id, verdict: 'publishable', repairSeconds: 0,
  sourceCompared: true, severeDefects: [], scores: Object.fromEntries(reviewDimensions.map((d) => [d, 4])) as ClipRating['scores'], notes: '', ...patch })
const submission = (reviewer: string, ratings: ClipRating[]): ReviewSubmission => ({ schemaVersion: 2, experimentId: 'frozen-experiment', reviewer, ratings })

describe('blind review integrity', () => {
  it('rejects source, creator, and recording leakage across splits', () => {
    for (const patch of [{ sourceSha256: 'a'.repeat(64) }, { creatorGroup: 'a' }, { recordingGroup: 'a' }]) {
      expect(() => validateReviewCases([source('a', 'a'), { ...source('b', 'b'), ...patch, split: 'development' }])).toThrow('crosses')
    }
    expect(validateReviewCases([{ ...source('a', 'a'), creatorGroup: undefined }])).toMatchObject({ groupingComplete: false })
    expect(validateReviewCases([source('a', 'a'), { ...source('b', 'b'), split: 'development' }]).groupingComplete).toBe(true)
  })

  it('requires the complete slot ledger, unique ranks, and at least two reviewers', () => {
    expect(() => validateReviewIndex({ ...index(), slots: index().slots.slice(1) })).toThrow('every run/case')
    expect(() => validateReviewIndex({ ...index(), minimumReviewers: 1 })).toThrow('at least two')
    expect(() => validateReviewIndex({ ...index(), slots: index().slots.map((s) => s.id === 'a2' ? { ...s, rank: 1 } : s) })).toThrow('Duplicate')
  })

  it.each([
    { verdict: 'great' }, { repairSeconds: -1 }, { repairSeconds: '30' }, { repairSeconds: Infinity },
    { verdict: 'reject', repairSeconds: 0 }, { verdict: 'publishable', repairSeconds: 10 },
    { severeDefects: ['wrong-speaker'] }, { verdict: 'repairable', severeDefects: ['unknown-defect'] },
    { verdict: 'repairable', severeDefects: ['wrong-speaker', 'wrong-speaker'] },
    { sourceCompared: 'yes' }, { notes: null }, { scores: {} },
    { scores: { ...rating('a1').scores, overall: null } }, { scores: { ...rating('a1').scores, hook: 6 } }
  ])('rejects malformed or contradictory ratings: %j', (patch) => {
    expect(() => validateReviewSubmission(submission('r1', [{ ...rating('a1'), ...patch } as ClipRating]), index())).toThrow()
  })

  it('rejects unknown clips, mixed experiments, duplicate ratings and duplicate reviewers', () => {
    expect(() => validateReviewSubmission(submission('r1', [rating('unknown')]), index())).toThrow('unknown')
    expect(() => validateReviewSubmission(submission('r1', [rating('a2')]), index())).toThrow('unavailable')
    expect(() => validateReviewSubmission({ ...submission('r1', []), experimentId: 'other' }, index())).toThrow('different experiment')
    expect(() => validateReviewSubmission(submission('r1', [rating('a1'), rating('a1')]), index())).toThrow('Duplicate clip')
    expect(() => aggregateQualityReviews(index(), [submission('r1', []), submission('r1', [])])).toThrow('Duplicate reviewer')
    expect(() => validateReviewSubmission({ schemaVersion: 1 }, index())).toThrow('legacy')
  })
})

describe('measured editorial quality and coverage', () => {
  it('retains unrated, missing, short-yield, and unknown output slots without calling them successes', () => {
    const result = aggregateQualityReviews(index(), [submission('r1', [rating('a1')])])
    expect(result.slots).toHaveLength(6)
    expect(result.runs[0].summary).toMatchObject({ eligibleTopKSlots: 6, returned: 4, rendered: 3,
      missingRenders: 1, missingOutputSlots: 1, unknownOutputSlots: 1, rated: 1, fullyReviewed: 0,
      publishable: 0, reviewedReturnedCoverage: 0, publishableAmongReviewed: null, medianRepairSeconds: null })
    const empty = aggregateQualityReviews(index(), []).runs[0].summary
    expect(empty.reviewedSlotCoverage).toBe(0)
    expect(empty.severeDefectRateAmongRated).toBeNull()
  })

  it('requires independent complete reviews and exposes disagreement and severe defects', () => {
    const result = aggregateQualityReviews(index(), [
      submission('r1', [rating('a1'), rating('b1', { verdict: 'repairable', repairSeconds: 30, severeDefects: ['wrong-speaker'] })]),
      submission('r2', [rating('a1'), rating('b1', { verdict: 'reject', repairSeconds: null })])
    ])
    expect(result.runs[0].summary).toMatchObject({ fullyReviewed: 2, publishable: 1,
      reviewedReturnedCoverage: 0.5, reviewedSlotCoverage: 1 / 3, publishableAmongReviewed: 0.5,
      publishablePerTopKSlot: 1 / 6, severeDefectClips: 1, severeDefectRateAmongRated: 0.5,
      disagreements: 1, measuredRepairClips: 1, medianRepairSeconds: 0, readyPublishableAmongReviewed: 1 })
    expect(result.runs[0].summary.severeDefects['wrong-speaker']).toBe(1)
    expect(result.slots.find((s) => s.id === 'b1')).toMatchObject({ accepted: false, medianRepairSeconds: null })
  })

  it('reports measured repair times separately from untimed accepted clips', () => {
    const result = aggregateQualityReviews(index(), [
      submission('r1', [rating('a1', { repairSeconds: null }), rating('b1', { verdict: 'repairable', repairSeconds: 50 }), rating('b2', { verdict: 'repairable', repairSeconds: 10 })]),
      submission('r2', [rating('a1', { repairSeconds: null }), rating('b1', { verdict: 'repairable', repairSeconds: 70 }), rating('b2', { verdict: 'repairable', repairSeconds: null })])
    ])
    expect(result.runs[0].summary).toMatchObject({ accepted: 3, measuredRepairClips: 1, repairMeasurementCoverage: 1 / 3, medianRepairSeconds: 60 })
  })

  it('is deterministic across input order and clusters repeated cases of one source together', () => {
    const fixture = index()
    const submissions = [submission('r1', [rating('a1'), rating('b1')]), submission('r2', [rating('a1'), rating('b1')])]
    const result = aggregateQualityReviews(fixture, submissions)
    expect(aggregateQualityReviews({ ...fixture, slots: [...fixture.slots].reverse(), cases: [...fixture.cases].reverse() }, [...submissions].reverse())).toEqual(result)
    expect(result.runs[0].summary.publishableYieldSourceInterval95).toMatchObject({ sourceCount: 2, low: 1 / 3, high: 1 / 3 })
    const sameSource = { ...fixture, cases: fixture.cases.map((c) => ({ ...c, sourceSha256: 'a'.repeat(64) })) }
    expect(aggregateQualityReviews(sameSource, submissions).runs[0].summary.publishableYieldSourceInterval95).toBeNull()
  })
})
