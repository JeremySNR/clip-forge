import { describe, expect, it } from 'vitest'
import { ASD_FPS, shouldAbortFaceDetection, trackCoverageRatio } from '../src/main/pipeline/asd'
import type { FaceTrack } from '../src/main/pipeline/facetracks'
import type { FaceBox } from '../src/main/pipeline/speaker'

const box = (cx: number): FaceBox => ({
  x1: cx - 0.1,
  y1: 0.3,
  x2: cx + 0.1,
  y2: 0.5,
  score: 0.9
})

function track(start: number, len: number): FaceTrack {
  return { start, boxes: Array.from({ length: len }, () => box(0.5)) }
}

describe('shouldAbortFaceDetection', () => {
  it('bails after the probe window when no faces were found', () => {
    const probeEnd = 8 * ASD_FPS
    expect(shouldAbortFaceDetection(probeEnd - 1, 100, 0, -1)).toBe(false)
    expect(shouldAbortFaceDetection(probeEnd, 100, 0, -1)).toBe(true)
  })

  it('keeps scanning when enough faces appear in the probe window', () => {
    const probeEnd = 8 * ASD_FPS
    expect(shouldAbortFaceDetection(probeEnd, 100, 3, probeEnd - 25)).toBe(false)
  })

  it('bails once faces disappear for several seconds (screen share)', () => {
    const lastFace = 5 * ASD_FPS
    const absentLimit = 3 * ASD_FPS
    expect(shouldAbortFaceDetection(lastFace + absentLimit - 1, 50, 20, lastFace)).toBe(false)
    expect(shouldAbortFaceDetection(lastFace + absentLimit, 50, 20, lastFace)).toBe(true)
  })
})

describe('trackCoverageRatio', () => {
  it('sums coverage across tracks', () => {
    expect(trackCoverageRatio([track(0, 50), track(80, 20)], 100)).toBe(0.7)
  })

  it('returns zero for empty tracks', () => {
    expect(trackCoverageRatio([], 100)).toBe(0)
  })
})
