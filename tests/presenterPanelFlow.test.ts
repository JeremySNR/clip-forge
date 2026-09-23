import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { Clip, ContentRegion } from '@shared/types'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'

const chat = vi.hoisted(() => vi.fn())
const panel = vi.hoisted(() => vi.fn())
vi.mock('../src/main/pipeline/openai', () => ({ chatJSON: chat }))
vi.mock('../src/main/pipeline/shotTriage', () => ({ detectPresenterPanel: panel }))
import { refineComposition } from '../src/main/pipeline/composition'

/** The top-right webcam found from pixels (T3.GG-style recording). */
const webcam: ContentRegion = { x: 0.83, y: 0, width: 0.17, height: 0.28 }

function overlap(a: ContentRegion, b: ContentRegion): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
}

async function withVideo(run: (video: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-pixel-presenter-'))
  try {
    const video = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=5:d=3',
      '-vf', 'drawbox=x=200:y=250:w=700:h=400:color=blue:t=fill', '-c:v', 'mpeg4', video])
    await run(video)
  } finally { await rm(dir, { recursive: true, force: true }) }
}

const screenClip = (panels?: NonNullable<Clip['visualLayout']>['panels']): Clip => ({
  title: 'Emails classified', edit: { start: 0, end: 3, aspect: '9:16' },
  visualLayout: { kind: 'screen', start: 0, end: 3, preserveContext: true, allowZoom: false, reason: 'screen', panels }
}) as Clip

it('replaces a model webcam box that merged two webcams with the pixel panel', async () => {
  await withVideo(async video => {
    panel.mockReset().mockResolvedValue(webcam)
    chat.mockReset()
      // The model encloses the primary webcam and an embedded one in one tall box.
      .mockResolvedValueOnce({ mode: 'fit', reason: 'table', screen_detail: true,
        region: { left: 150, top: 200, right: 860, bottom: 800 },
        presenter: { left: 780, top: 30, right: 990, bottom: 930 } })
      .mockResolvedValueOnce({ accept: true, reason: 'Readable table and presenter', legible_labels: ['Inbox'] })
    const clip = screenClip()
    await refineComposition('unused', 'unused', video, clip, [])
    const prompt = chat.mock.calls[0][2][0].content as Array<{ text?: string }>
    expect(prompt.some(p => p.text?.includes('left=830, top=0, right=1000, bottom=280'))).toBe(true)
    const layers = clip.visualLayout!.shots![0].composition!.layers
    const presenter = layers.find(l => l.role === 'presenter')!.source
    const content = layers.find(l => l.role === 'content')!.source
    // The pixel panel with the usual 3% overscan, never the model's tall box.
    expect(presenter.x).toBeCloseTo(0.83 + 0.17 * 0.03, 5)
    expect(presenter.height).toBeCloseTo(0.28 * 0.94, 5)
    expect(overlap(content, webcam)).toBeLessThan(1e-9)
    expect(clip.visualLayout!.shots![0].review?.status).toBe('checked')
  })
})

it('composes a webcam the model missed, and trims editorial content off it', async () => {
  await withVideo(async video => {
    panel.mockReset().mockResolvedValue(webcam)
    chat.mockReset()
      .mockResolvedValueOnce({ mode: 'fit', reason: 'chart', screen_detail: false,
        region: { left: 100, top: 200, right: 900, bottom: 950 }, presenter: { left: 0, top: 0, right: 0, bottom: 0 } })
      .mockResolvedValueOnce({ accept: true, reason: 'Readable', legible_labels: ['Chart'] })
    const missed = screenClip()
    await refineComposition('unused', 'unused', video, missed, [])
    expect(missed.visualLayout!.shots![0].composition?.layers.map(l => l.role)).toEqual(['content', 'presenter'])

    // An editorial content panel drawn under the webcam is cut back before review.
    chat.mockReset().mockResolvedValue({ accept: true, reason: 'Readable', legible_labels: ['Chart'] })
    const editorial = screenClip({ content: { x: 0.1, y: 0.1, width: 0.85, height: 0.8 },
      presenter: { x: 0.7, y: 0, width: 0.3, height: 0.9 } })
    await refineComposition('unused', 'unused', video, editorial, [])
    expect(chat.mock.calls[0][3]).toBe('presenter_composition_review')
    const content = editorial.visualLayout!.shots![0].composition!.layers.find(l => l.role === 'content')!.source
    expect(overlap(content, webcam)).toBeLessThan(1e-9)
  })
})

it('keeps the model path when no pixel panel is found', async () => {
  await withVideo(async video => {
    panel.mockReset().mockResolvedValue(undefined)
    chat.mockReset().mockResolvedValueOnce({ mode: 'fit', reason: 'slide', screen_detail: false,
      region: { left: 0, top: 0, right: 1000, bottom: 1000 }, presenter: { left: 0, top: 0, right: 0, bottom: 0 } })
    const clip = screenClip()
    await refineComposition('unused', 'unused', video, clip, [])
    const prompt = chat.mock.calls[0][2][0].content as Array<{ text?: string }>
    expect(prompt.some(p => p.text?.includes('pixel scan'))).toBe(false)
    expect(clip.visualLayout!.shots![0].composition).toBeUndefined()
  })
})
