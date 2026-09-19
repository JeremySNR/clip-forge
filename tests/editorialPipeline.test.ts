import { beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AnalyzeOptions, Clip, Project } from '@shared/types'
import { makeTranscript } from './helpers'

const mocks = vi.hoisted(() => ({ highlights: vi.fn(), transcript: vi.fn(), assess: vi.fn(), complete: vi.fn(),
  faces: vi.fn(), composition: vi.fn(), save: vi.fn(), projectDir: vi.fn() }))
vi.mock('../src/main/settings', () => ({ getApiKey: () => 'key', getModelPreferences: () => ({ analysisModel: 'test' }), getImportPreferences: vi.fn() }))
vi.mock('../src/main/projects', () => ({ projectDir: mocks.projectDir, saveProject: vi.fn(), updateProject: mocks.save }))
vi.mock('../src/main/pipeline/projectTranscript', () => ({ ensureTranscript: mocks.transcript }))
vi.mock('../src/main/pipeline/highlights', () => ({ detectHighlights: mocks.highlights, maxDurationFor: () => 45 }))
vi.mock('../src/main/pipeline/visualScore', () => ({ assessClipVisuals: mocks.assess, ensembleScore: (a: number, b: number) => Math.round((a + b) / 2) }))
vi.mock('../src/main/pipeline/visualStory', () => ({ completeVisualStory: mocks.complete }))
vi.mock('../src/main/pipeline/faces', () => ({ analyzeClipFocus: mocks.faces, applyFocusAnalysis: vi.fn() }))
vi.mock('../src/main/pipeline/composition', () => ({ refineComposition: mocks.composition }))
vi.mock('../src/main/pipeline/broll', () => ({ attachBroll: vi.fn() }))
vi.mock('../src/main/pipeline/ytdlp', () => ({}))
vi.mock('../src/main/pipeline/ffmpeg', () => ({ extractThumbnail: async () => null, probeVideo: vi.fn() }))
import { analyzeProject } from '../src/main/pipeline'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let project: Project
const options = { videoType: 'product-demo', clipLength: 'short', prompt: '', broll: false } as AnalyzeOptions
const review = { needsVisualPayoff: false, visualScore: 80, visualSummary: 'Complete', visualLayout: { start: 0, end: 10, preserveContext: true, allowZoom: false, reason: 'demo' } }

beforeEach(() => {
  vi.clearAllMocks()
  const clip = { id: 'clip', title: 'Demo', suggestedStart: 0, suggestedEnd: 10, viralityScore: 60,
    edit: { start: 0, end: 10, tightenCuts: true } } as Clip
  project = { id: randomUUID(), clips: [], video: { path: 'source.mp4', durationSec: 100 } } as unknown as Project
  mocks.highlights.mockResolvedValue([clip])
  mocks.transcript.mockResolvedValue(makeTranscript(['Here is the result']))
  mocks.assess.mockResolvedValue(review)
  mocks.complete.mockResolvedValue(null)
  mocks.faces.mockResolvedValue({ focusTrack: null, contentType: 'screencast' })
  mocks.projectDir.mockImplementation(() => join(tmpdir(), 'clipforge', `job-${project.id}`))
  mocks.save.mockImplementation(async (_: string, update: (p: Project) => void) => { update(project); return project })
})

it('reviews content composition for explicit product demos without running face tracking', async () => {
  const result = await analyzeProject(project, options, () => {})
  expect(mocks.faces).not.toHaveBeenCalled()
  expect(mocks.composition).toHaveBeenCalledOnce()
  expect(mocks.composition.mock.calls[0][6]).toBeNull()
  expect(result.clips[0].reframeStatus).toBe('done')
})

it('does not recommend a known incomplete demonstration when repair fails', async () => {
  mocks.assess.mockResolvedValue({ ...review, needsVisualPayoff: true })
  await expect(analyzeProject(project, options, () => {})).rejects.toThrow('payoffs could not be included')
  expect(mocks.composition).not.toHaveBeenCalled()
})

it('reviews a repaired edit before recommending it and saves its final assessment', async () => {
  mocks.assess.mockResolvedValueOnce({ ...review, needsVisualPayoff: true,
    storyIssue:{kind:'unresolved_ending',evidenceQuote:'Here comes the result',reason:'Result not shown.'} }).mockResolvedValueOnce(review)
  const [clip] = await mocks.highlights()
  mocks.complete.mockResolvedValue({ ...clip, edit: { ...clip.edit, end: 40 }, suggestedEnd: 40, visualStory: { protectedRanges: [{ start: 30, end: 40 }], reason: 'Result' } })
  const result = await analyzeProject(project, options, () => {})
  expect(mocks.assess).toHaveBeenCalledTimes(2)
  expect(result.clips[0].visualStory?.protectedRanges).toEqual([{ start: 30, end: 40 }])
  expect(result.clips[0].visualSummary).toBe('Complete')
})

it('does not recommend a repair when its second review fails', async () => {
  mocks.assess.mockResolvedValueOnce({ ...review, needsVisualPayoff: true }).mockResolvedValueOnce(null)
  const [clip] = await mocks.highlights()
  mocks.complete.mockResolvedValue(clip)
  await expect(analyzeProject(project, options, () => {})).rejects.toThrow('payoffs could not be included')
})

it('rejects a grounded incoherent story despite its high numerical score', async () => {
  mocks.assess.mockResolvedValue({...review,visualScore:99,storyIssue:{kind:'unrelated_scene',evidenceQuote:'We already tried that one.',reason:'Unexplained new scene.'}})
  await expect(analyzeProject(project,options,()=>{})).rejects.toThrow('complete, self-contained stories')
  expect(mocks.composition).not.toHaveBeenCalled()
})

it('keeps a complete alternative when another candidate is incoherent', async () => {
  const [clip]=await mocks.highlights()
  mocks.highlights.mockResolvedValue([clip,{...clip,id:'alternative'}])
  mocks.assess.mockImplementation(async (_key,_model,_path,_transcript,c) => c.id==='clip'
    ? {...review,storyIssue:{kind:'unresolved_ending',evidenceQuote:'A dangling last phrase',reason:'Unresolved.'}}
    : review)
  const result=await analyzeProject(project,options,()=>{})
  expect(result.clips.map(c=>c.id)).toEqual(['alternative'])
})
