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

it('verifies a proposed region using real extracted JPEG frames', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clipforge-composition-'))
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
  const dir = await mkdtemp(join(tmpdir(), 'clipforge-detail-'))
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
