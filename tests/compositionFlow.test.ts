import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { Clip } from '@shared/types'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'

const chat = vi.hoisted(() => vi.fn())
vi.mock('../src/main/pipeline/openai', () => ({ chatJSON: chat }))
import { refineComposition } from '../src/main/pipeline/composition'
import { refineScreenDetails } from '../src/main/pipeline/screenDetail'
import { reviewPresenterComposition } from '../src/main/pipeline/presenterComposition'

it('renders and verifies a separate presenter from any source corner with bounded repair', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-presenter-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=5:duration=2', '-c:v', 'mpeg4', video])
    chat.mockReset()
    chat.mockResolvedValueOnce({ mode: 'fit', reason: 'screen and webcam', screen_detail: true,
      region: { left: 200, top: 300, right: 800, bottom: 900 },
      presenter: { left: 820, top: 20, right: 980, bottom: 280 } })
      .mockResolvedValueOnce({ accept: false, reason: 'Try a larger presenter', legible_labels: [] })
      .mockResolvedValueOnce({ accept: true, reason: 'Readable labels and clear presenter', legible_labels: ['Response quality'] })
    const clip = { title: 'Graph', edit: { start: 0, end: 2, aspect: '9:16' },
      visualLayout: { start: 0, end: 2, preserveContext: true, allowZoom: false, reason: 'screen' } } as Clip
    await refineComposition('unused', 'unused', video, clip, [])
    expect(chat).toHaveBeenCalledTimes(3)
    expect(clip.visualLayout?.shots?.[0]).toMatchObject({ mode: 'fit', composition: { preset: 'stacked' }, review: { status: 'checked' } })
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)

it('reviews native 4K inset detail instead of rejecting its smaller thumbnail', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-native-inset-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=5:duration=1', '-c:v', 'mpeg4', video])
    chat.mockReset()
    chat.mockResolvedValueOnce({ accept: true, reason: 'Native inset is legible', legible_labels: ['Graph'] })
    const result = await reviewPresenterComposition('unused', 'unused', video, 0, 1,
      { x: .05, y: .2, width: .7, height: .7 }, { x: .9, y: .05, width: .04, height: .1 }, 'Graph')
    expect(result.composition?.preset).toBe('content-first')
    expect(chat).toHaveBeenCalledTimes(1)
    expect(chat.mock.calls[0][2][0].content.filter((part: { type: string }) => part.type === 'image_url')).toHaveLength(7)
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)

it('retains the full scene when a contradictory inset proposal has invalid bounds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-invalid-inset-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=5:duration=1', '-c:v', 'mpeg4', video])
    chat.mockReset()
    chat.mockResolvedValue({ mode: 'crop', screen_detail: true,
      region: { left: 0, top: 0, right: 700, bottom: 1000 },
      presenter: { left: 800, top: 0, right: 1200, bottom: 400 } })
    const clip = { title: 'Graph', edit: { start: 0, end: 1, aspect: '9:16' },
      visualLayout: { start: 0, end: 1, preserveContext: true, allowZoom: false, reason: 'screen' } } as Clip
    await refineComposition('unused', 'unused', video, clip, [], undefined, [{ t: 0, x: .9 }])
    expect(chat).toHaveBeenCalledTimes(1)
    expect(clip.visualLayout?.shots).toEqual([{ start: 0, end: 1, mode: 'fit', review: expect.objectContaining({ status: 'needs-review' }) }])
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 15000)

it('verifies a proposed region using real extracted JPEG frames', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-composition-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=5:duration=2',
      '-c:v', 'mpeg4', video])
    chat.mockReset()
    chat.mockResolvedValueOnce({ mode: 'fit', reason: 'Important demonstration', screen_detail: false,
      region: { left: 200, top: 0, right: 800, bottom: 1000 } })
      .mockResolvedValueOnce({ accept: true, reason: 'The object remains visible' })
    const clip = { title: 'Demonstration', edit: { start: 0, end: 2 },
      visualLayout: { start: 0, end: 2, preserveContext: true, allowZoom: false,
        reason: 'Keep the object visible' } } as Clip
    await refineComposition('unused', 'unused', video, clip, [])
    expect(chat).toHaveBeenCalledTimes(2)
    expect(clip.visualLayout?.shots?.[0]).toMatchObject({ mode: 'fit', region: expect.any(Object) })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 15000)

it('verifies an overview and detail plan using real extracted JPEG frames', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-detail-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=5:duration=2',
      '-c:v', 'mpeg4', video])
    chat.mockReset()
    chat.mockResolvedValueOnce({ intervals: [{ start_frame: 0, end_frame: 8, detail: true,
      region: { left: 650, top: 200, right: 980, bottom: 630 } }], reason: 'Enlarge relevant UI' })
      .mockResolvedValueOnce({ accept: true, reason: 'Readable controls', legible_labels: ['Control'] })
    const transcript = { language: 'en', durationSec: 2, segments: [] }
    const shots = await refineScreenDetails('unused', 'unused', video, 'Screen demo', 0, 2, transcript)
    expect(chat).toHaveBeenCalledTimes(2)
    expect(shots?.[0]).toMatchObject({ mode: 'fit', overview: true, region: expect.any(Object) })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 15000)
