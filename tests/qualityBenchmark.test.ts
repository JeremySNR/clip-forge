import { describe, expect, it } from 'vitest'
import { evaluateQuality, scoreFocus, scoreHighlights, scoreSpeakers, scoreWords,
  validateQualitySample, type QualitySample } from '@shared/qualityBenchmark'

const words = (text: string) => text.split(' ').map((text, i) => ({ text, start: i, end: i + 0.8 }))
const sample = (patch: Partial<QualitySample> = {}): QualitySample => ({
  sourceSha256: 'a'.repeat(64), durationSec: 10, ...patch
})

describe('word and alignment evaluation', () => {
  it('measures insertion, deletion, substitution and Unicode-normalized matches', () => {
    expect(scoreWords(words('one two three'), words('one four three five'))).toMatchObject({
      referenceWords: 3, substitutions: 1, insertions: 1, deletions: 0, wordErrorRate: 2 / 3
    })
    expect(scoreWords(words('one two three'), words('one three')).deletions).toBe(1)
    expect(scoreWords(words('CAFÉ hello!'), words('café hello')).wordErrorRate).toBe(0)
  })

  it('exposes timing error alongside matched coverage, including empty predictions', () => {
    const predicted = words('one two').map((w) => ({ ...w, start: w.start + 0.3, end: w.end + 0.3 }))
    const scored = scoreWords(words('one two'), predicted)
    expect(scored.boundaryErrorP95Sec).toBeCloseTo(0.3)
    expect(scored.matchedWordFraction).toBe(1)
    expect(scoreWords(words('one two'), [])).toMatchObject({ wordErrorRate: 1, boundaryErrorP95Sec: null })
    expect(scoreWords([], words('hallucination'))).toMatchObject({ wordErrorRate: null, insertions: 1 })
  })
})

describe('speaker and visible target evaluation', () => {
  it('counts overlap in speaker-seconds and includes silence false alarms', () => {
    const result = scoreSpeakers([
      { start: 0, end: 4, speaker: 'a' }, { start: 2, end: 4, speaker: 'b' }
    ], [{ start: 0, end: 5, speaker: 'a' }], 5)
    expect(result).toMatchObject({ referenceSpeakerSec: 6, missedSpeakerSec: 2,
      falseAlarmSpeakerSec: 1, confusedSpeakerSec: 0, diarizationErrorRate: 0.5 })
  })

  it('does not mistake the correct number of speakers for correct identity', () => {
    expect(scoreSpeakers([{ start: 0, end: 4, speaker: 'a' }],
      [{ start: 0, end: 4, speaker: 'b' }], 4).diarizationErrorRate).toBe(1)
  })

  it('allows wide shots when labelled and penalizes missing visual decisions', () => {
    const scored = scoreFocus([
      { start: 0, end: 4, targets: ['a', 'b'] }, { start: 4, end: 8, targets: [null] }
    ], [{ start: 0, end: 3, targets: ['b'] }, { start: 4, end: 8, targets: [null] }], 10)
    expect(scored).toEqual({ labelledSec: 8, wrongTargetSec: 1, missingDecisionSec: 1, wrongTargetRate: 1 / 8 })
  })
})

describe('highlight evaluation', () => {
  const gold = [{ start: 0, end: 10 }, { start: 20, end: 30 }]
  it('does not reward duplicate candidates or candidates below top K', () => {
    expect(scoreHighlights(gold, [gold[0], gold[0], gold[1]], 2, 0.5)).toMatchObject({
      matchedMoments: 1, precision: 0.5, recall: 0.5
    })
    expect(scoreHighlights(gold, [gold[0], gold[0], gold[1]], 3, 0.5).recall).toBe(1)
  })

  it('reports yield against the requested budget when fewer than K candidates exist', () => {
    expect(scoreHighlights(gold, [gold[0]], 5, 0.5)).toMatchObject({ returned: 1, returnedFraction: 0.2,
      matchedPerRequestedSlot: 0.2, precision: 1, recall: 0.5 })
  })

  it('finds maximum matching when a broad clip could match either moment', () => {
    const ref = [{ start: 0, end: 10 }, { start: 10, end: 20 }]
    expect(scoreHighlights(ref, [{ start: 0, end: 20 }, ref[0]], 2, 0.5).matchedMoments).toBe(2)
  })
})

describe('benchmark integrity', () => {
  it('distinguishes unavailable metrics from empty predictions', () => {
    const ref = sample({ words: words('hello'), speakers: [{ start: 0, end: 2, speaker: 'a' }] })
    expect(evaluateQuality(ref, sample()).words).toBeNull()
    expect(evaluateQuality(ref, sample({ words: [] })).words?.wordErrorRate).toBe(1)
  })

  it('refuses unrelated media and invalid timestamps', () => {
    expect(() => evaluateQuality(sample(), sample({ sourceSha256: 'b'.repeat(64) }))).toThrow('different source')
    expect(() => evaluateQuality(sample(), sample({ durationSec: 11 }))).toThrow('different source')
    expect(() => validateQualitySample(sample({ words: [{ text: 'bad', start: 2, end: 1 }] }))).toThrow('timestamps')
    expect(() => validateQualitySample(sample({ highlights: [{ start: 0, end: 11 }] }))).toThrow('timestamps')
    expect(() => validateQualitySample(sample({ focus: [{ start: 0, end: 1, targets: ['a', 'b'] }] }), true)).toThrow('exactly one')
  })
})
