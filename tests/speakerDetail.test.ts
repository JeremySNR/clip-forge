import { expect, it } from 'vitest'
import { lowDetailShotRanges, type SpeakerCandidate } from '../src/main/pipeline/speaker'
import { protectLayoutRanges } from '@shared/contentType'

const track = (start: number, length: number, area: number): SpeakerCandidate => ({
  start, centres: Array(length).fill(.5), areas: Array(length).fill(area), scores: Array(length).fill(2)
})

it('protects a wide shot with tiny faces even when the speaker model gives positive scores', () => {
  // Gilly regression: normal shot ~.039 area; wide-shot detections ~.0006.
  const result = lowDetailShotRanges([track(0, 750, .039), track(750, 175, .0006)], 925, [750], 25)
  expect(result).toEqual([{ start: 30, end: 37 }])
})

it('does not widen an ordinary talking shot because of brief tracking gaps', () => {
  expect(lowDetailShotRanges([track(10, 80, .02)], 100, [], 25)).toEqual([])
})

it('requires resolved mouth detail and a clear speaker margin before trusting small faces', () => {
  const speaker = track(0, 100, .0006)
  const listener = { ...track(0, 100, .0006), scores: Array(100).fill(-1) }
  expect(lowDetailShotRanges([speaker, listener], 100, [], 25, { width: 1920, height: 1080 })).toEqual([])
  expect(lowDetailShotRanges([speaker, listener], 100, [], 25, { width: 640, height: 360 })).toHaveLength(1)
  listener.scores.fill(2)
  expect(lowDetailShotRanges([speaker, listener], 100, [], 25, { width: 1920, height: 1080 })).toHaveLength(1)
})

it('protects a no-face shot without suppressing the following close-up', () => {
  expect(lowDetailShotRanges([track(50, 50, .02)], 100, [50], 25))
    .toEqual([{ start: 0, end: 2 }])
})

it('does not use a large listener to excuse an unresolved speaking face', () => {
  const speaker = track(0, 100, .0001)
  const listener = { ...track(0, 100, .02), scores: Array(100).fill(-1) }
  const size = { width: 1920, height: 1080 }
  expect(lowDetailShotRanges([speaker, listener], 100, [], 25, size))
    .toEqual([{ start: 0, end: 4 }])
  expect(lowDetailShotRanges([listener, speaker], 100, [], 25, size))
    .toEqual([{ start: 0, end: 4 }])
  speaker.areas.fill(.02)
  expect(lowDetailShotRanges([speaker, listener], 100, [], 25, size)).toEqual([])
})

it('overrides unsafe speaker crops while retaining existing protected slides', () => {
  const result = protectLayoutRanges({ start: 0, end: 30, preserveContext: true, allowZoom: false, reason: 'Slide',
    shots: [{ start: 0, end: 5, mode: 'fit' }, { start: 5, end: 30, mode: 'crop' }] },
  0, 30, [{ start: 25, end: 30 }])
  expect(result?.shots).toEqual([
    { start: 0, end: 5, mode: 'fit' }, { start: 5, end: 25, mode: 'crop' }, { start: 25, end: 30, mode: 'fit' }
  ])
})
