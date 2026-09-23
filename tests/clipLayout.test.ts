import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clip } from '@shared/types'
import { needsReframe } from '@shared/reframe'
const mocks = vi.hoisted(() => ({ faces: vi.fn(), apply: vi.fn(), compose: vi.fn(), assess: vi.fn(), cuts: vi.fn(), panel: vi.fn() }))
vi.mock('../src/main/pipeline/shotTriage', () => ({ detectPresenterPanel: mocks.panel, triageClipStyle: vi.fn() }))
vi.mock('../src/main/pipeline/ffmpeg', () => ({ probeVideo: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }) }))
vi.mock('../src/main/pipeline/faces', () => ({ analyzeClipFocus: mocks.faces, applyFocusAnalysis: mocks.apply }))
vi.mock('../src/main/pipeline/composition', () => ({ refineComposition: mocks.compose }))
vi.mock('../src/main/pipeline/screenCuts', () => ({ screenTransitions: mocks.cuts }))
vi.mock('../src/main/pipeline/visualScore', () => ({ assessClipVisuals: mocks.assess }))
import { analyzeClipLayout } from '../src/main/pipeline/clipLayout'

const clip = (kind?: 'screen' | 'camera' | 'mixed'): Clip => ({ id: 'clip',
  suggestedStart: 0, suggestedEnd: 30, edit: { start: 5, end: 25, aspect: '9:16' },
  visualLayout: { start: 0, end: 30, kind, preserveContext: true, allowZoom: false, reason: 'Context' }
}) as Clip
beforeEach(() => {
  vi.clearAllMocks()
  mocks.cuts.mockResolvedValue([])
  mocks.panel.mockResolvedValue(undefined)
  mocks.faces.mockResolvedValue({ focusTrack: [{ t: 5, x: .5 }], contentType: 'speaker' })
})
it('splits changed screen geometry before spending a whole-clip review', async () => {
  const c = clip('screen')
  c.visualLayout!.panels = { content: { x: .2, y: .3, width: .6, height: .6 },
    presenter: { x: .82, y: .02, width: .16, height: .26 } }
  mocks.cuts.mockResolvedValue([{ start: 12, end: 13 }])
  await analyzeClipLayout('video.mp4', c, 'auto', 'key', 'model')
  expect(mocks.cuts).toHaveBeenCalledOnce()
  expect(mocks.compose).toHaveBeenCalledOnce()
  expect(mocks.compose.mock.calls[0][3].visualLayout.panels).toBeUndefined()
  expect(mocks.compose.mock.calls[0][7]).toEqual([{ start: 12, end: 13 }])
})
it('skips dense speaker inference for screen evidence and still verifies composition', async () => {
  const c = clip('screen')
  await analyzeClipLayout('video.mp4', c, 'auto', 'key', 'model')
  expect(mocks.faces).not.toHaveBeenCalled()
  expect(mocks.compose).toHaveBeenCalledOnce()
  expect(c.reframeStatus).toBe('done')
  expect(needsReframe(c)).toBe(false)
})
it.each(['camera', 'mixed'] as const)('retains speaker tracking for %s footage', async kind => {
  await analyzeClipLayout('video.mp4', clip(kind), 'auto', 'key', 'model')
  expect(mocks.faces.mock.calls[0].slice(1, 3)).toEqual([5, 25])
})
it('respects an explicit talking-head choice even when the visual pass says screen', async () => {
  await analyzeClipLayout('video.mp4', clip('screen'), 'talking-head', 'key', 'model')
  expect(mocks.faces).toHaveBeenCalledOnce()
  expect(mocks.compose).not.toHaveBeenCalled()
})
it('refreshes old screen evidence once, including after a trim extension', async () => {
  const c = clip(), transcript = { language: 'en', durationSec: 50, segments: [] }
  mocks.assess.mockResolvedValue({ visualLayout: clip('screen').visualLayout })
  await analyzeClipLayout('video.mp4', c, 'auto', 'key', 'model', transcript)
  expect(mocks.assess).toHaveBeenCalledOnce()
  expect(mocks.faces).not.toHaveBeenCalled()
  await analyzeClipLayout('video.mp4', c, 'auto', 'key', 'model', transcript)
  expect(mocks.assess).toHaveBeenCalledOnce()
  c.edit.end = 40
  await analyzeClipLayout('video.mp4', c, 'auto', 'key', 'model', transcript)
  expect(mocks.assess).toHaveBeenCalledTimes(2)
})
it('never marks a cancelled composition done', async () => {
  const c = clip('screen'), controller = new AbortController()
  mocks.compose.mockImplementationOnce(async () => controller.abort())
  await expect(analyzeClipLayout('video.mp4', c, 'auto', 'key', 'model', undefined, controller.signal)).rejects.toThrow()
  expect(c.reframeStatus).toBeUndefined()
})
it('migrates old automatic letterboxes once while retaining manual corrections', () => {
  const c = clip()
  Object.assign(c.edit, { reframeMode: 'fit-letterbox', framing: 'manual', focusX: .5, autoZoom: false })
  c.reframeStatus = 'done'
  c.reframeAnalysis = { start: 0, end: 30, version: 1 }
  expect(needsReframe(c)).toBe(true)
  c.visualLayout!.revision = 1
  expect(needsReframe(c)).toBe(false)
  c.visualLayout!.revision = 0
  c.reframeAnalysis.version = 2
  expect(needsReframe(c)).toBe(false)
})

describe('webcam panels found in the pixels', () => {
  const panel = { x: 0.75, y: 0, width: 0.25, height: 0.3 }
  it('routes camera-labelled screen shares as screens instead of cropping to the webcam', async () => {
    mocks.panel.mockResolvedValue(panel)
    const c = clip('camera')
    await analyzeClipLayout('video.mp4', c, 'auto', 'key', 'model')
    expect(mocks.faces).not.toHaveBeenCalled()
    expect(mocks.compose).toHaveBeenCalledOnce()
    expect(mocks.compose.mock.calls[0][3].visualLayout).toMatchObject({ kind: 'screen', start: 5, end: 25 })
  })
  it('composes content and webcam offline, flagged for review', async () => {
    mocks.panel.mockResolvedValue(panel)
    const c = { ...clip(), visualLayout: undefined } as Clip
    await analyzeClipLayout('video.mp4', c, 'auto', '', 'model')
    expect(mocks.faces).not.toHaveBeenCalled()
    expect(mocks.compose).not.toHaveBeenCalled()
    const shot = c.visualLayout!.shots![0]
    expect(shot.composition?.layers.map(l => l.role)).toEqual(['content', 'presenter'])
    expect(shot.review?.status).toBe('needs-review')
  })
  it('leaves mixed footage and explicit talking heads on speaker tracking', async () => {
    mocks.panel.mockResolvedValue(panel)
    await analyzeClipLayout('video.mp4', clip('mixed'), 'auto', 'key', 'model')
    await analyzeClipLayout('video.mp4', clip('camera'), 'talking-head', 'key', 'model')
    expect(mocks.panel).not.toHaveBeenCalled()
    expect(mocks.faces).toHaveBeenCalledTimes(2)
  })
})
