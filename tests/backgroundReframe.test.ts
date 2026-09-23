import { beforeEach, expect, it, vi } from 'vitest'
import type { BackgroundReframeEvent, Clip, Project } from '@shared/types'

const ensure = vi.hoisted(() => vi.fn())
vi.mock('../src/main/pipeline/reframe', () => ({ ensureClipReframe: ensure }))
import { cancelBackgroundReframes, startBackgroundReframes } from '../src/main/pipeline/backgroundReframe'

const clip = (id: string, score: number, status: Clip['reframeStatus'] = 'pending'): Clip =>
  ({ id, viralityScore: score, reframeStatus: status }) as Clip
let project: Project

beforeEach(() => {
  vi.clearAllMocks()
  project = { id: 'p', clips: [clip('a', 90), clip('b', 85), clip('c', 80, 'done'), clip('low', 5)] } as Project
  ensure.mockImplementation(async (_p: string, id: string) =>
    ({ ...project, clips: project.clips.map(c => c.id === id ? { ...c, reframeStatus: 'done' } : c) }))
})

it('analyses only pending top clips and reports each result as it lands', async () => {
  const events: BackgroundReframeEvent[] = []
  await startBackgroundReframes(project, e => events.push(e))
  const analysed = ensure.mock.calls.map(call => call[1])
  expect(analysed).toContain('a')
  expect(analysed).toContain('b')
  expect(analysed).not.toContain('c')
  const done = events.filter(e => e.state === 'done')
  expect(done.map(e => e.clipId).sort()).toEqual([...analysed].sort())
  expect(done.every(e => e.state === 'done' && e.clip.reframeStatus === 'done')).toBe(true)
})

it('keeps going after one clip fails and leaves it pending for an on-demand retry', async () => {
  ensure.mockImplementationOnce(async () => { throw new Error('Request failed') })
  const events: BackgroundReframeEvent[] = []
  await startBackgroundReframes(project, e => events.push(e))
  expect(events.filter(e => e.state === 'failed')).toHaveLength(1)
  expect(events.filter(e => e.state === 'done').length).toBeGreaterThan(0)
})

it('stops waiting when cancelled and clears the Framing badge for aborted clips', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  ensure.mockImplementation(async (_p: string, _id: string, signal: AbortSignal) => {
    await gate
    signal.throwIfAborted()
    return project
  })
  const events: BackgroundReframeEvent[] = []
  const run = startBackgroundReframes(project, e => events.push(e))
  cancelBackgroundReframes('p')
  release()
  await run
  const started = events.filter(e => e.state === 'running').map(e => e.clipId).sort()
  const cleared = events.filter(e => e.state === 'failed').map(e => e.clipId).sort()
  expect(started.length).toBeGreaterThan(0)
  expect(cleared).toEqual(started)
  expect(events.some(e => e.state === 'done')).toBe(false)
})
