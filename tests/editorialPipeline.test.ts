import { beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AnalyzeOptions, Clip, Project } from '@shared/types'
import { makeTranscript } from './helpers'

const mocks = vi.hoisted(() => ({ highlights: vi.fn(), transcript: vi.fn(), assess: vi.fn(), complete: vi.fn(),
  faces: vi.fn(), composition: vi.fn(), save: vi.fn(), projectDir: vi.fn(), discovery: vi.fn(), rank: vi.fn() }))
vi.mock('../src/main/settings', () => ({ getAnalysisCredential: () => 'key', getModelPreferences: () => ({ analysisModel: 'test' }), getImportPreferences: vi.fn() }))
vi.mock('../src/main/projects', () => ({ projectDir: mocks.projectDir, saveProject: vi.fn(), updateProject: mocks.save }))
vi.mock('../src/main/pipeline/projectTranscript', () => ({ ensureTranscript: mocks.transcript }))
vi.mock('../src/main/pipeline/highlights', async importOriginal => ({
  ...await importOriginal<typeof import('../src/main/pipeline/highlights')>(),
  detectHighlights: mocks.highlights, maxDurationFor: () => 45
}))
vi.mock('../src/main/pipeline/sourceDiscovery', () => ({ discoverSourceMoments: mocks.discovery }))
vi.mock('../src/main/pipeline/editorialReview', () => ({ rankEditorialCandidates: mocks.rank }))
vi.mock('../src/main/pipeline/screenCuts', () => ({ screenTransitions: async () => [] }))
vi.mock('../src/main/pipeline/visualScore', () => ({ assessClipVisuals: mocks.assess, ensembleScore: (a: number, b: number) => Math.round((a + b) / 2) }))
vi.mock('../src/main/pipeline/visualStory', () => ({ completeVisualStory: mocks.complete }))
vi.mock('../src/main/pipeline/faces', () => ({ analyzeClipFocus: mocks.faces, applyFocusAnalysis: vi.fn() }))
vi.mock('../src/main/pipeline/composition', () => ({ refineComposition: mocks.composition }))
vi.mock('../src/main/pipeline/broll', () => ({ attachBroll: vi.fn() }))
vi.mock('../src/main/pipeline/ytdlp', () => ({}))
vi.mock('../src/main/pipeline/ffmpeg', () => ({ extractThumbnail: async () => null, probeVideo: vi.fn() }))
import { analyzeProject } from '../src/main/pipeline'
import { analyzeClipLayout } from '../src/main/pipeline/clipLayout'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let project: Project
const options = { videoType: 'product-demo', clipLength: 'short', prompt: '', broll: false, editorialRanking: true } as AnalyzeOptions
const review = { needsVisualPayoff: false, visualScore: 80, visualSummary: 'Complete', visualLayout: { kind: 'screen', start: 0, end: 10, preserveContext: true, allowZoom: false, reason: 'demo' } }

beforeEach(() => {
  vi.clearAllMocks()
  const clip = { id: 'clip', title: 'Demo', suggestedStart: 0, suggestedEnd: 10, viralityScore: 60,
    edit: { start: 0, end: 10, tightenCuts: true } } as Clip
  project = { id: randomUUID(), clips: [], video: { path: 'source.mp4', durationSec: 100 } } as unknown as Project
  mocks.highlights.mockResolvedValue([clip])
  mocks.transcript.mockResolvedValue(makeTranscript(['Here is the result']))
  mocks.assess.mockResolvedValue(review)
  mocks.complete.mockResolvedValue(null)
  mocks.discovery.mockResolvedValue({ version: 1, status: 'complete', candidates: [] })
  mocks.rank.mockImplementation(async ({ baselineClips }) => ({ clips: baselineClips, report: { version: 1, candidateCount: baselineClips.length } }))
  mocks.faces.mockResolvedValue({ focusTrack: null, contentType: 'screencast' })
  mocks.projectDir.mockImplementation(() => join(tmpdir(), 'cutawan', `job-${project.id}`))
  mocks.save.mockImplementation(async (_: string, update: (p: Project) => void) => { update(project); return project })
})

it('returns scored clips before any layout analysis runs', async () => {
  const result = await analyzeProject(project, options, () => {})
  expect(mocks.faces).not.toHaveBeenCalled()
  expect(mocks.composition).not.toHaveBeenCalled()
  expect(result.clips[0].reframeStatus).toBe('pending')
  expect(mocks.discovery).not.toHaveBeenCalled()
  expect(mocks.rank).toHaveBeenCalledOnce()
  expect(result.rankingEnabled).toBe(true)
  expect(result.editorialRanking?.generationId).toBe(result.clipsGenerationId)
})

it('keeps the legacy ranking available without making editorial review calls', async () => {
  project.editorialRanking = { version: 1 } as Project['editorialRanking']
  const result = await analyzeProject(project, { ...options, editorialRanking: undefined }, () => {})
  expect(mocks.rank).not.toHaveBeenCalled()
  expect(result.editorialRanking).toBeUndefined()
  expect(result.rankingEnabled).toBe(false)
})

it('persists the review report and previous edits when every new candidate is rejected', async () => {
  const [previous] = await mocks.highlights(); project.clips = [previous]
  project.clipsGenerationId = 'previous-generation'
  mocks.rank.mockResolvedValue({ clips: [], report: { version: 1, candidateCount: 1, rejectedCount: 1 } })
  await expect(analyzeProject(project, options, () => {})).rejects.toThrow('incomplete or misleading')
  expect(project.clips).toEqual([previous])
  expect(project.editorialRanking?.rejectedCount).toBe(1)
  expect(project.clipsGenerationId).toBe('previous-generation')
  expect(project.editorialRanking?.generationId).not.toBe('previous-generation')
})

it('uses editorial selection order instead of re-sorting by legacy scores', async () => {
  const [high] = await mocks.highlights()
  const low = { ...high, id: 'more-useful', viralityScore: 30, suggestedStart: 40, suggestedEnd: 45,
    edit: { ...high.edit, start: 40, end: 45 } }
  mocks.highlights.mockResolvedValue([high, low])
  mocks.rank.mockImplementation(async ({ clips }) => ({ clips: [...clips].reverse(), report: { version: 1, candidateCount: 2 } }))
  const result = await analyzeProject(project, options, () => {})
  expect(result.clips.map(c => c.id)).toEqual(['more-useful', 'clip'])
  expect(mocks.rank.mock.calls[0][0].baselineClips.map((c: Clip) => c.id)).toEqual(['clip', 'more-useful'])
})

it('discovers a silent demonstration even when the transcript has no candidates', async () => {
  mocks.transcript.mockResolvedValue({ language: 'en', durationSec: 100, segments: [], speech: [] })
  mocks.discovery.mockResolvedValue({ version: 1, status: 'complete', candidates: [{
    id: 'visual', start: 20, end: 35, title: 'A visible result', summary: 'The device works', score: 70,
    reason: 'Observed setup, action and result', kind: 'demonstration', protectedRange: { start: 20, end: 35 },
    evidence: [{ time: 21, role: 'before', observation: 'Stopped' }, { time: 30, role: 'result', observation: 'Running' }],
    sampleTimes: [21, 30], timingUncertaintySec: 1
  }] })
  const result = await analyzeProject(project, { ...options, visualDiscovery: true }, () => {})
  expect(mocks.highlights).not.toHaveBeenCalled()
  expect(mocks.discovery).toHaveBeenCalledOnce()
  expect(result.clips).toHaveLength(1)
  expect(result.clips[0].discovery?.origin).toBe('visual')
  expect(result.clips[0].edit.captionsEnabled).toBe(false)
  expect(result.clips[0].visualStory?.protectedRanges).toEqual([{ start: 20, end: 35 }])
  expect(result.discoveryReport?.candidates).toHaveLength(1)
  expect(result.discoveryReport?.generationId).toBe(result.clipsGenerationId)
})

it('persists unsuccessful scan coverage and preserves previous clips when no new moments exist', async () => {
  const [previous] = await mocks.highlights()
  project.clips = [previous]
  mocks.transcript.mockResolvedValue({ language: 'en', durationSec: 100, segments: [] })
  mocks.discovery.mockResolvedValue({ version: 1, status: 'failed', candidates: [] })
  await expect(analyzeProject(project, { ...options, visualDiscovery: true }, () => {})).rejects.toThrow('visual scan failed')
  expect(project.discoveryReport?.status).toBe('failed')
  expect(project.clips).toEqual([previous])
  expect(project.discoveryReport?.generationId).not.toBe(project.clipsGenerationId)
})

it('does not silently swallow a discovery budget or cancellation failure', async () => {
  mocks.discovery.mockRejectedValue(new Error('Daily request cap reached'))
  await expect(analyzeProject(project, { ...options, visualDiscovery: true }, () => {})).rejects.toThrow('Daily request cap')
  expect(mocks.highlights).not.toHaveBeenCalled()
})

it('deduplicates after visual-payoff expansion', async () => {
  const [original] = await mocks.highlights()
  mocks.highlights.mockResolvedValue([original, { ...original, id: 'later', suggestedStart: 20, suggestedEnd: 35,
    edit: { ...original.edit, start: 20, end: 35 } }])
  mocks.assess.mockImplementation(async (_key, _model, _path, _transcript, clip) => ({
    ...review, needsVisualPayoff: clip.id === 'clip' && clip.edit.end === 10
  }))
  mocks.complete.mockResolvedValue({ ...original, suggestedEnd: 35, edit: { ...original.edit, end: 35 } })
  const result = await analyzeProject(project, options, () => {})
  expect(result.clips).toHaveLength(1)
})

it('reviews content composition for explicit product demos without running face tracking', async () => {
  const [clip] = await analyzeProject(project, options, () => {}).then(p => p.clips)
  await analyzeClipLayout('source.mp4', clip, 'product-demo', 'key', 'test', makeTranscript(['Here is the result']))
  expect(mocks.faces).not.toHaveBeenCalled()
  expect(mocks.composition).toHaveBeenCalledOnce()
  expect(mocks.composition.mock.calls[0][6]).toBeNull()
  expect(clip.reframeStatus).toBe('done')
})

it('does not recommend a known incomplete demonstration when repair fails', async () => {
  mocks.assess.mockResolvedValue({ ...review, needsVisualPayoff: true })
  await expect(analyzeProject(project, options, () => {})).rejects.toThrow('payoffs could not be included')
  expect(mocks.composition).not.toHaveBeenCalled()
})

it('reviews a repaired edit before recommending it and saves its final assessment', async () => {
  mocks.assess.mockResolvedValueOnce({ ...review, needsVisualPayoff: true,
    storyIssue:{kind:'unresolved_ending',evidenceQuote:'Here comes the result',reason:'Result not shown.'} }).mockResolvedValueOnce({ ...review, visualLayout: { ...review.visualLayout, end: 40 } })
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
