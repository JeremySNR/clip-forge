import { describe, expect, it, vi } from 'vitest'
import type { FaceTrack } from '../src/main/pipeline/facetracks'

const state = vi.hoisted(() => ({ faces: new Set<number>(), cuts: new Set<number>(), count: 750 }))
vi.mock('../src/main/pipeline/ffmpeg', () => ({
  streamRawFrames: async (_args: string[], _bytes: number,
    callback: (frame: Buffer, f: number) => Promise<void>, signal?: AbortSignal) => {
    for (let f = 0; f < state.count; f++) {
      signal?.throwIfAborted()
      const frame = Buffer.alloc(4)
      frame.writeUInt32LE(f)
      await callback(frame, f)
    }
  },
  runFfmpeg: vi.fn(), probeVideo: vi.fn()
}))
vi.mock('../src/main/pipeline/detect', () => ({
  MODEL_W: 1, MODEL_H: 1, modelsDir: () => '',
  frameDifference: (_a: Buffer, b: Buffer) => state.cuts.has(b.readUInt32LE()) ? 255 : 0,
  detectFaces: async (frame: Buffer) => state.faces.has(frame.readUInt32LE())
    ? [{ x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.5, score: 0.9 }] : []
}))

import { runDetectionPass, sceneTransitionRanges, shouldDetectFaces, trackCoverageRatio } from '../src/main/pipeline/asd'

describe('transition intervals', () => {
  it('separates a dissolve shoulder from stable talking shots', () => {
    expect(sceneTransitionRanges([0, 1, 2, 8, 16, 30, 18, 9, 2, 1])).toEqual([{ start: 3, end: 8 }])
    expect(sceneTransitionRanges([0, 1, 40, 1, 0])).toEqual([{ start: 2, end: 3 }])
    expect(sceneTransitionRanges([0, 8, 9, 8, 1])).toEqual([])
  })
})

describe('continuous face scouting', () => {
  it.each([false, true])('finds a speaker after a long face-free passage (earlier speaker: %s)', async (earlier) => {
    state.faces = new Set(Array.from({ length: 250 }, (_, i) => 500 + i))
    if (earlier) for (let f = 0; f < 125; f++) state.faces.add(f)
    state.cuts = new Set([451]) // a shot cut late in the previously skipped suffix
    const result = await runDetectionPass('unused', 0, 30)
    expect(result.frameCount).toBe(750)
    expect(result.facesPerFrame.slice(500, 513).some((f) => f?.length)).toBe(true)
    expect(result.facesPerFrame[745]).toHaveLength(1) // dense (every 5th frame) while a face is present
    expect(result.sceneCuts).toContain(451)
    expect(result.faceFrameRatio).toBeCloseTo(earlier ? 0.5 : 1 / 3, 1)
  })

  it('scouts indefinitely and reacts immediately to shot cuts', () => {
    expect(shouldDetectFaces(1200, -1)).toBe(true)
    expect(shouldDetectFaces(1201, -1)).toBe(false)
    expect(shouldDetectFaces(1201, -1, true)).toBe(true)
    expect(shouldDetectFaces(1205, 1200)).toBe(true)
    expect(shouldDetectFaces(1202, 1200)).toBe(false)
  })

  it('honours user cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runDetectionPass('unused', 0, 30, controller.signal)).rejects.toThrow()
  })
})

describe('track coverage', () => {
  const track = (start: number, length: number): FaceTrack => ({
    start, boxes: Array.from({ length }, () => ({ x1: 0, y1: 0, x2: 1, y2: 1, score: 1 }))
  })
  it('counts simultaneous faces once and clamps to the actual video', () => {
    expect(trackCoverageRatio([track(0, 50), track(0, 50)], 100)).toBe(0.5)
    expect(trackCoverageRatio([track(80, 40), track(0, 50)], 100)).toBe(0.7)
    expect(trackCoverageRatio([track(0, 200)], 100)).toBe(1)
    expect(trackCoverageRatio([], 0)).toBe(0)
  })
})

describe('halveRgb', () => {
  it('averages 2x2 blocks per channel for half-resolution face detection', async () => {
    const { halveRgb } = await import('../src/main/pipeline/asd')
    // 2x2 RGB image: red, green / blue, white.
    const rgb = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])
    const half = halveRgb(rgb, 2, 2)
    expect([half.width, half.height]).toEqual([1, 1])
    expect([...half.data]).toEqual([128, 128, 128])
  })
})
