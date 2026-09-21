import { beforeEach, expect, it, vi } from 'vitest'
import type { Clip } from '@shared/types'

const mocks = vi.hoisted(() => ({ chat: vi.fn(), frames: vi.fn(), ffmpeg: vi.fn() }))
vi.mock('../src/main/pipeline/openai', () => ({ chatJSON: mocks.chat }))
vi.mock('../src/main/pipeline/visualScore', () => ({
  extractClipFrames: mocks.frames,
  clipFrameTimes: (start: number, end: number) => [start + .2, (start + end) / 2, end - .2]
}))
vi.mock('../src/main/pipeline/ffmpeg', () => ({ runAnalysisFfmpeg: mocks.ffmpeg, probeImageDimensions: async () => ({ width: 512, height: 288 }) }))
vi.mock('node:fs/promises', () => ({ readFile: async () => Buffer.from('image'), rm: async () => undefined }))
import { refineComposition } from '../src/main/pipeline/composition'

const fixture = (): Clip => ({
  title: 'Static interview', edit: { start: 10, end: 40 },
  visualLayout: { start: 10, end: 40, preserveContext: true, allowZoom: false, reason: 'Background monitor' }
}) as Clip

beforeEach(() => {
  vi.clearAllMocks()
  mocks.frames.mockResolvedValue(['/temporary/review/f0.jpg', '/temporary/review/f1.jpg', '/temporary/review/f2.jpg'])
  mocks.chat.mockResolvedValue({ mode: 'crop', reason: 'Background is incidental' })
})

it('checks the actual crop for a static shot without requiring a camera cut', async () => {
  const clip = fixture()
  await refineComposition('key', 'model', 'source.mp4', clip, [], undefined, [{ t: 10, x: .3 }])
  expect(clip.visualLayout?.shots).toEqual([{ start: 10, end: 40, mode: 'crop' }])
  expect(mocks.ffmpeg.mock.calls[0][0].join(' ')).toContain('iw*0.30000')
})

it('preserves the context when the proposed crop cannot be verified', async () => {
  const clip = fixture()
  mocks.chat.mockResolvedValue({ mode: 'unknown' })
  await refineComposition('key', 'model', 'source.mp4', clip, [], undefined, [{ t: 10, x: .3 }])
  expect(clip.visualLayout?.shots?.[0].mode).toBe('fit')
})

it('does not invent a face-centred crop when tracking found no face', async () => {
  const clip = fixture()
  await refineComposition('key', 'model', 'source.mp4', clip, [], undefined, null)
  expect(clip.visualLayout?.shots).toEqual([{ start: 10, end: 40, mode: 'fit' }])
})

it.each([true, false])('accepts a content region only after verification: %s', async (accept) => {
  const clip = fixture()
  mocks.chat.mockResolvedValueOnce({ mode: 'fit', region: { left: 250, top: 0, right: 750, bottom: 1000 } })
    .mockResolvedValueOnce({ accept, reason: 'Containment check' })
  await refineComposition('key', 'model', 'source.mp4', clip, [], undefined, null)
  expect(Boolean(clip.visualLayout?.shots?.[0].region)).toBe(accept)
  expect(mocks.frames.mock.calls[1][3]).toBe(7)
})
