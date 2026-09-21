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
import { LayoutMemory } from '../src/main/pipeline/layoutMemory'
import { mediaJobs } from '../src/main/pipeline/mediaJobs'
import { presenterComposition } from '@shared/composition'

it.each(['wide-editorial', 'overlapping-editorial', 'wide-proposal', 'unrepairable'])(
  'repairs rejected source geometry once without lowering quality checks: %s', async kind => {
    const dir = await mkdtemp(join(tmpdir(), 'cutawan-bounds-repair-'))
    try {
      const video = join(dir, 'source.mp4')
      await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=5:d=1',
        '-vf', 'drawbox=x=500:y=300:w=700:h=500:color=blue:t=fill', '-c:v', 'mpeg4', video])
      const broad = { mode: 'fit', screen_detail: true,
        region: { left: 0, top: 0, right: 840, bottom: 1000 },
        presenter: { left: 842, top: 35, right: 989, bottom: 360 } }
      const clip = { title: 'Wide comparison slide', edit: { start: 0, end: 1, aspect: '9:16' }, visualLayout: {
        kind: 'screen', start: 0, end: 1, preserveContext: true, allowZoom: false, reason: 'comparison' } } as Clip
      if (kind.endsWith('editorial')) clip.visualLayout!.panels = {
        content: { x: 0, y: 0, width: .84, height: 1 },
        presenter: kind.startsWith('overlapping') ? { x: .78, y: .035, width: .215, height: .965 }
          : { x: .842, y: .035, width: .147, height: .325 } }
      chat.mockReset()
      if (!kind.endsWith('editorial')) chat.mockResolvedValueOnce(broad)
      if (kind === 'unrepairable') chat.mockResolvedValue(broad)
      else chat.mockResolvedValueOnce({ ...broad, region: { left: 230, top: 230, right: 670, bottom: 790 } })
        .mockResolvedValueOnce({ accept: true, reason: 'Relevant content retained', legible_labels: ['Comparison'] })
      await refineComposition('unused', 'unused', video, clip, [])
      expect(chat).toHaveBeenCalledTimes(kind === 'wide-proposal' ? 3 : 2)
      expect(chat.mock.calls[0][3]).toBe('shot_composition')
      const repair = chat.mock.calls[kind.endsWith('editorial') ? 0 : 1][2][0].content
      expect(repair.some((p: { text?: string }) => p.text?.includes('Repair'))).toBe(true)
      expect(Boolean(clip.visualLayout!.shots![0].composition)).toBe(kind !== 'unrepairable')
      if (kind !== 'unrepairable') expect(clip.visualLayout!.shots![0].review?.status).toBe('checked')
      else expect(clip.visualLayout!.shots![0].review?.reason).toContain('too broad')
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 15000)

it('repairs a brief edge collision missed by uniform samples using the actual problem frames', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-temporal-repair-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=20:d=6',
      '-vf', "drawbox=x=480:y=210:w=260:h=24:color=white:t=fill:enable='between(t,2.25,2.65)'",
      '-c:v', 'mpeg4', video])
    const clip = { title: 'Moving title', edit: { start: 0, end: 6, aspect: '9:16' }, visualLayout: {
      kind: 'screen', start: 0, end: 6, preserveContext: true, allowZoom: false, reason: 'demo',
      panels: { content: { x: .2, y: .35, width: .6, height: .55 },
        presenter: { x: .82, y: .02, width: .16, height: .26 } } } } as Clip
    chat.mockReset()
    chat.mockResolvedValueOnce({ accept: false, reason: 'Title clipped', legible_labels: [] })
      .mockResolvedValueOnce({ mode: 'fit', screen_detail: true,
      region: { left: 200, top: 200, right: 800, bottom: 900 },
      presenter: { left: 820, top: 20, right: 980, bottom: 280 } })
      .mockResolvedValueOnce({ accept: true, reason: 'Title retained', legible_labels: ['Title'] })
    await refineComposition('unused', 'unused', video, clip, [])
    expect(chat).toHaveBeenCalledTimes(3)
    expect(chat.mock.calls[0][3]).toBe('presenter_composition_review')
    expect(chat.mock.calls[0][2][0].content.filter((p: { type: string }) => p.type === 'image_url')).toHaveLength(10)
    expect(chat.mock.calls[1][3]).toBe('shot_composition')
    expect(chat.mock.calls[1][2][0].content.filter((p: { type: string }) => p.type === 'image_url')).toHaveLength(6)
    expect(chat.mock.calls[2][3]).toBe('presenter_composition_review')
    expect(clip.visualLayout!.shots![0].composition!.layers[0].source.y).toBeCloseTo(.15)
    expect(clip.visualLayout!.shots![0]).not.toHaveProperty('retryTimes')
    // A harmless guide can pass the augmented review without new bounds.
    clip.visualLayout!.shots = undefined
    chat.mockReset()
    chat.mockResolvedValue({ accept: true, reason: 'Only an editing guide crosses the crop', legible_labels: ['Title'] })
    await refineComposition('unused', 'unused', video, clip, [])
    expect(chat).toHaveBeenCalledOnce()
    expect(chat.mock.calls[0][2][0].content.filter((p: { type: string }) => p.type === 'image_url')).toHaveLength(10)
    expect(clip.visualLayout!.shots![0].composition).toBeDefined()
    expect(clip.visualLayout!.shots![0]).not.toHaveProperty('retryTimes')
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 15000)

it('releases the media slot during cloud review so another clip and export can proceed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-review-concurrency-'))
  let release!: () => void
  const cloud = new Promise<void>(resolve => { release = resolve })
  const pending: Promise<void>[] = []
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=5:duration=1', '-c:v', 'mpeg4', video])
    chat.mockReset()
    chat.mockImplementation(async () => { await cloud; return { mode: 'fit', screen_detail: false } })
    const clip = { title: 'Demo', edit: { start: 0, end: 1 }, visualLayout: {
      start: 0, end: 1, preserveContext: true, allowZoom: false, reason: 'demo' } } as Clip
    pending.push(refineComposition('unused', 'unused', video, structuredClone(clip), []))
    await vi.waitFor(() => expect(chat).toHaveBeenCalledOnce(), { timeout: 8000 })
    pending.push(refineComposition('unused', 'unused', video, structuredClone(clip), []))
    let admitted = false
    pending.push(mediaJobs.run(async () => { admitted = true }, undefined, 1))
    await vi.waitFor(() => { expect(admitted).toBe(true); expect(chat).toHaveBeenCalledTimes(2) }, { timeout: 8000 })
  } finally {
    release()
    await Promise.all(pending)
    await rm(dir, { recursive: true, force: true })
  }
}, 20000)

it.each([true, false])('requires fresh rendered verification of a reused layout and repairs rejection: %s', async accept => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-reused-layout-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=5:d=1',
      '-vf', 'drawbox=x=320:y=300:w=400:h=200:color=blue:t=fill', '-c:v', 'mpeg4', video])
    const example = presenterComposition({ x: .2, y: .3, width: .6, height: .6 },
      { x: .82, y: .02, width: .16, height: .26 })!
    const memory = new LayoutMemory(video)
    vi.spyOn(memory, 'propose').mockResolvedValue(example)
    const clip = { title: 'New narration', edit: { start: 0, end: 1, aspect: '9:16' }, visualLayout: {
      kind: 'screen', start: 0, end: 1, preserveContext: true, allowZoom: false, reason: 'demo' } } as Clip
    chat.mockReset()
    chat.mockResolvedValueOnce({ accept, reason: 'New interval checked', legible_labels: accept ? ['Graph'] : [] })
      .mockResolvedValueOnce({ mode: 'fit', screen_detail: false })
    await refineComposition('unused', 'unused', video, clip, [], undefined, null, [], undefined, memory)
    expect(chat.mock.calls[0][3]).toBe('presenter_composition_review')
    expect(chat.mock.calls[0][2][0].content.filter((p: { type: string }) => p.type === 'image_url')).toHaveLength(7)
    expect(chat).toHaveBeenCalledTimes(accept ? 1 : 2)
    expect(clip.visualLayout!.shots![0].composition).toEqual(accept ? example : undefined)
    if (!accept) expect(chat.mock.calls[1][3]).toBe('shot_composition')
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 20000)

it('vetoes a clipped title in a retrieved crop before spending a review request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-reuse-edge-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=5:d=1',
      '-vf', 'drawbox=x=480:y=208:w=260:h=24:color=white:t=fill', '-c:v', 'mpeg4', video])
    const memory = new LayoutMemory(video)
    vi.spyOn(memory, 'propose').mockResolvedValue(presenterComposition(
      { x: .2, y: .3, width: .6, height: .6 }, { x: .82, y: .02, width: .16, height: .26 }))
    const clip = { title: 'Moved title', edit: { start: 0, end: 1, aspect: '9:16' }, visualLayout: {
      kind: 'screen', start: 0, end: 1, preserveContext: true, allowZoom: false, reason: 'demo' } } as Clip
    chat.mockReset()
    chat.mockResolvedValue({ mode: 'fit', screen_detail: false })
    await refineComposition('unused', 'unused', video, clip, [], undefined, null, [], undefined, memory)
    expect(chat).toHaveBeenCalledOnce()
    expect(chat.mock.calls[0][3]).toBe('shot_composition')
    expect(clip.visualLayout!.shots![0].composition).toBeUndefined()
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 15000)

it('renders and verifies a separate presenter from any source corner with bounded repair', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-presenter-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=5:d=2',
      '-vf', 'drawbox=x=320:y=300:w=400:h=200:color=blue:t=fill', '-c:v', 'mpeg4', video])
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

it('reuses source-review panels but verifies independent rendered samples', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-proposed-panels-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=5:d=2',
      '-vf', 'drawbox=x=320:y=300:w=400:h=200:color=blue:t=fill', '-c:v', 'mpeg4', video])
    chat.mockReset()
    chat.mockResolvedValue({ accept: true, reason: 'Verified output', legible_labels: ['Graph'] })
    const clip = { title: 'Graph', edit: { start: 0, end: 2, aspect: '9:16' },
      visualLayout: { start: 0, end: 2, kind: 'screen', preserveContext: true, allowZoom: false, reason: 'screen',
        panels: { content: { x: .2, y: .3, width: .6, height: .6 },
          presenter: { x: .82, y: .02, width: .16, height: .26 } } } } as Clip
    await refineComposition('unused', 'unused', video, clip, [])
    expect(chat).toHaveBeenCalledOnce()
    expect(chat.mock.calls[0][3]).toBe('presenter_composition_review')
    expect(clip.visualLayout?.shots?.[0].composition).toBeDefined()
    chat.mockReset()
    chat.mockResolvedValue({ accept: false, reason: 'Webcam moved', legible_labels: [] })
    await refineComposition('unused', 'unused', video, clip, [])
    expect(clip.visualLayout?.shots?.[0].composition).toBeUndefined()
    expect(clip.visualLayout?.shots?.[0].review?.status).toBe('needs-review')
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)
