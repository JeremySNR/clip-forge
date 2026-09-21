import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clip, Project } from '@shared/types'
import { initialClipEditForVideoType } from '@shared/videoType'
import { needsReframe } from '@shared/reframe'

const state = vi.hoisted(() => ({ project: null as Project | null, analyse: vi.fn() }))
vi.mock('../src/main/projects', () => ({
  loadProject: async () => structuredClone(state.project!),
  updateProject: async (_id: string, mutate: (p: Project) => void) => {
    mutate(state.project!)
    return structuredClone(state.project!)
  }
}))
vi.mock('../src/main/pipeline/faces', () => ({
  analyzeClipFocus: state.analyse,
  applyFocusAnalysis: (clip: Clip) => { clip.focusTrack = [{ t: clip.edit.start, x: 0.3 }] }
}))
import { ensureClipReframe } from '../src/main/pipeline/reframe'

describe('framing coverage across async edits', () => {
  beforeEach(() => {
    state.analyse.mockReset()
    state.project = {
      id: 'race', videoType: 'podcast', sourceMissing: false, video: { path: 'source.mp4' },
      clips: [{ id: 'clip', suggestedStart: 0, suggestedEnd: 30, reframeStatus: 'pending',
        focusTrack: null, edit: { ...initialClipEditForVideoType('podcast'), start: 0, end: 30 } }]
    } as Project
  })

  it('reanalyses a trim extended during inference before returning an exportable clip', async () => {
    let finish!: () => void
    state.analyse.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
      .mockResolvedValue({ focusTrack: null, contentType: 'speaker' })
    const running = ensureClipReframe('race', 'clip')
    await vi.waitFor(() => expect(state.analyse).toHaveBeenCalledTimes(1))
    state.project!.clips[0].edit.end = 45
    finish()
    const result = await running
    expect(state.analyse).toHaveBeenCalledTimes(2)
    expect(state.analyse.mock.calls[1].slice(1, 3)).toEqual([0, 45])
    expect(result.clips[0].reframeAnalysis).toEqual({ start: 0, end: 45, version: 2 })
    expect(needsReframe(result.clips[0])).toBe(false)
  })

  it('does not run inference or persist a pre-cancelled request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(ensureClipReframe('race', 'clip', controller.signal)).rejects.toThrow()
    expect(state.analyse).not.toHaveBeenCalled()
    expect(state.project!.clips[0].reframeStatus).toBe('pending')
  })

  it('discards analysis completed after relinking even when the file path is unchanged', async () => {
    let finish!: () => void
    state.analyse.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
      .mockResolvedValue({ focusTrack: null, contentType: 'speaker' })
    const running = ensureClipReframe('race', 'clip')
    await vi.waitFor(() => expect(state.analyse).toHaveBeenCalledTimes(1))
    state.project!.sourceRevision = 1
    finish()
    await running
    expect(state.analyse).toHaveBeenCalledTimes(2)
  })
})
