import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Clip, Transcript, VideoInfo } from '@shared/types'
import { makeTranscript } from './helpers'

const mocks = vi.hoisted(() => ({ chat: vi.fn(), frames: vi.fn() }))
vi.mock('../src/main/pipeline/openai', async importOriginal => ({
  ...await importOriginal<typeof import('../src/main/pipeline/openai')>(), chatJSON: mocks.chat
}))
vi.mock('../src/main/subscription', () => ({ usesSubscription: () => false,
  throwIfSubscriptionError: (e: unknown) => { if (e instanceof Error && e.name === 'SubscriptionError') throw e }
}))
vi.mock('../src/main/pipeline/visualScore', async importOriginal => ({
  ...await importOriginal<typeof import('../src/main/pipeline/visualScore')>(), extractFramesAtTimes: mocks.frames
}))
vi.mock('electron', () => ({ app: undefined }))
import { editorialInput, rankEditorialCandidates, validateEditorialReview, validateRepeatedIdeas } from '../src/main/pipeline/editorialReview'
import { OpenAIError } from '../src/main/pipeline/openai'

let root: string, source: string, frameDirs: string[], transcript: Transcript
function clip(id = 'c1', start = 0, end = 6): Clip {
  return { id, title: 'Invented dramatic headline', hook: 'Invented hook', viralityScore: 99, viralityReason: 'Old score',
    suggestedStart: start, suggestedEnd: end, edit: { start, end, tightenCuts: false } } as Clip
}
function response(c: Clip, overrides: Record<string, unknown> = {}) {
  const input = editorialInput(c, transcript)
  return { id: c.id, story: 'complete', fidelity: 'supported',
    scores: { hook: 3, clarity: 3, value: 3, payoff: 3, audienceFit: null }, reason: 'The action and result form a complete point.',
    concerns: [], takeaway: 'A specific useful demonstration.',
    evidence: [{ kind: 'frame', time: Number(input.times[0].toFixed(3)), quote: 'The initial object is present.' },
      { kind: 'frame', time: Number(input.times.at(-1)!.toFixed(3)), quote: 'The result is visible.' }], ...overrides }
}
function options(clips = [clip()]) {
  return { video: { path: source, durationSec: 1000 } as VideoInfo, sourceRevision: 0, transcript, clips,
    baselineClips: clips, apiKey: 'fake', model: 'test-model', prompt: '' }
}
beforeEach(async () => {
  vi.clearAllMocks()
  root = await mkdtemp(join(tmpdir(), 'cutawan-editorial-')); source = join(root, 'source.mp4')
  await writeFile(source, 'Offline source bytes, not an actual video')
  frameDirs = []; transcript = makeTranscript(['This is an original complete thought.'])
  mocks.frames.mockImplementation(async (_path: string, times: number[], signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const dir = await mkdtemp(join(root, 'frames-')); frameDirs.push(dir)
    return Promise.all(times.map(async (_t, i) => { const path = join(dir, `${i}.jpg`); await writeFile(path, 'fake image'); return path }))
  })
  mocks.chat.mockImplementation(async (_key, _model, messages, schema) => {
    if (schema === 'editorial_diversity') return { repeated: [] }
    const parts = messages[1].content as Array<{ type: string; text?: string }>
    const inputs = parts.filter(p => p.type === 'text' && p.text?.startsWith('{')).map(p => JSON.parse(p.text!))
    return { reviews: inputs.map(i => response(clip(i.id, i.selectedSourceRanges[0].start, i.selectedSourceRanges.at(-1).end))) }
  })
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('editorial review evidence', () => {
  it('withholds generated headlines, old scores and route while using kept original speech and omitted context', () => {
    transcript = makeTranscript(['Earlier source context.', 'Selected original words.', 'Later source context.'])
    transcript.segments[1].words[0].sourceText = 'Selected'; transcript.segments[1].words[0].text = 'Misleading'
    const c = clip('c1', transcript.segments[1].start, transcript.segments[1].end)
    const input = editorialInput(c, transcript)
    expect(input.speech.filter(s => s.selected).map(s => s.text).join(' ')).toBe('Selected original words.')
    expect(input.speech.filter(s => !s.selected).map(s => s.text).join(' ')).toContain('Earlier source context.')
    c.edit.cuts = [{ start: c.edit.start, end: c.edit.end }]
    expect(editorialInput(c, transcript).times).toEqual([])
  })

  it('does not invent audience fit or turn null evidence into a zero score', () => {
    const c = clip(), input = editorialInput(c, transcript)
    const good = validateEditorialReview(response(c), input, transcript, false)
    expect(good).toMatchObject({ status: 'reviewed', score: 75, scores: { audienceFit: null } })
    expect(validateEditorialReview(response(c), input, transcript, true)).toMatchObject({ status: 'needs-review', score: null })
  })

  it.each([
    ['invented speech', { evidence: [{ kind: 'speech', time: 0, quote: 'A sentence not present in this source' }] }],
    ['invented timestamp', { evidence: [{ kind: 'frame', time: 900, quote: 'Something occurs' }] }],
    ['wrong candidate', { id: 'unknown' }],
    ['out-of-range score', { scores: { hook: 9, clarity: 3, value: 3, payoff: 3, audienceFit: null } }],
    ['missing score', { scores: { hook: 3 } }]
  ])('keeps %s as needing review', (_name, overrides) => {
    const c = clip(); expect(validateEditorialReview(response(c, overrides), editorialInput(c, transcript), transcript, false).status).toBe('needs-review')
  })

  it('requires selected and omitted speech evidence before rejecting a meaning change', () => {
    transcript = makeTranscript(['I used to believe this.', 'But I now reject that idea.'])
    const c = clip('c1', 0, transcript.segments[0].end), input = editorialInput(c, transcript)
    const unsupported = response(c, { fidelity: 'misleading', concerns: ['The speaker disagrees later.'] })
    expect(validateEditorialReview(unsupported, input, transcript, false).status).toBe('needs-review')
    const supported = { ...unsupported, evidence: [
      { kind: 'speech', time: 0, quote: 'I used to believe this' },
      { kind: 'speech', time: transcript.segments[1].start, quote: 'But I now reject that idea' }
    ] }
    expect(validateEditorialReview(supported, input, transcript, false).status).toBe('rejected')
  })

  it('retains uncertainty when context was truncated, even if the model says complete', () => {
    const c = clip(), input = { ...editorialInput(c, transcript), truncated: true }
    expect(validateEditorialReview(response(c), input, transcript, false)).toMatchObject({ status: 'needs-review', score: null })
  })

  it('does not reject a visual-only moment just because sparse stills missed a payoff', () => {
    transcript = { language: 'und', durationSec: 10, segments: [] }
    const c = clip(), input = editorialInput(c, transcript)
    expect(validateEditorialReview(response(c, { story: 'incomplete', concerns: ['The result is not in the samples.'] }), input, transcript, false))
      .toMatchObject({ status: 'needs-review', story: 'uncertain', score: null })
  })

  it('requires a meaningful spoken phrase before hard-rejecting a story', () => {
    const c = clip(), input = editorialInput(c, transcript)
    const verdict = response(c, { story: 'incomplete', concerns: ['The thought is unfinished.'],
      evidence: [{ kind: 'speech', time: 0, quote: 'This' }] })
    expect(validateEditorialReview(verdict, input, transcript, false).status).toBe('needs-review')
    verdict.evidence = [{ kind: 'speech', time: 0, quote: 'This is an original complete thought' }]
    expect(validateEditorialReview(verdict, input, transcript, false).status).toBe('rejected')
  })

  it('requires specific known candidate pairs without duplicates for semantic diversity', () => {
    const ids = new Set(['a', 'b'])
    expect(validateRepeatedIdeas({ repeated: [{ first: 'a', second: 'b', reason: 'Same precise takeaway.' }] }, ids)).toHaveLength(1)
    expect(validateRepeatedIdeas({ repeated: [{ first: 'a', second: 'missing', reason: 'Topic' }] }, ids)).toBeNull()
    expect(validateRepeatedIdeas({ repeated: [{ first: 'a', second: 'a', reason: 'Topic' }] }, ids)).toBeNull()
  })
})

describe('bounded independent ranking', () => {
  it('freezes a reproducible baseline and transcript without mutating candidate scores', async () => {
    const c = clip(), result = await rankEditorialCandidates(options([c]))
    expect(result.clips[0].editorial).toMatchObject({ status: 'reviewed', score: 75 })
    expect(result.report).toMatchObject({ candidateCount: 1, reviewedCount: 1, reviewRequestCount: 1, diversityRequestCount: 0 })
    expect(result.report.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(c.editorial).toBeUndefined()
    transcript.segments[0].words[0].text = 'Later correction'
    c.edit.end = 100
    expect(result.report.baseline.clips[0].edit.end).toBe(6)
    expect(result.report.transcript.segments[0].words[0].text).toBe('This')
    const sent = JSON.stringify(mocks.chat.mock.calls[0][2])
    expect(sent).not.toContain('Invented dramatic headline'); expect(sent).not.toContain('Old score')
    for (const dir of frameDirs) await expect(readdir(dir)).rejects.toThrow()
  })

  it('supports silent visual candidates using distinct visible evidence', async () => {
    transcript = { language: 'und', durationSec: 10, segments: [] }
    const result = await rankEditorialCandidates(options())
    expect(result.clips[0].editorial?.status).toBe('reviewed')
  })

  it('retains missing/duplicate response IDs and outages as unscored review-needed clips', async () => {
    mocks.chat.mockResolvedValue({ reviews: [] })
    expect((await rankEditorialCandidates(options())).clips[0].editorial).toMatchObject({ status: 'needs-review', score: null })
    mocks.chat.mockRejectedValue(new Error('Network unavailable'))
    expect((await rankEditorialCandidates(options())).report.needsReviewCount).toBe(1)
  })

  it('does not turn failed image extraction into positive text-only review', async () => {
    mocks.frames.mockRejectedValue(new Error('Decoder failed'))
    expect((await rankEditorialCandidates(options())).report).toMatchObject({ needsReviewCount: 1, reviewRequestCount: 0 })
    expect(mocks.chat).not.toHaveBeenCalled()
  })

  it.each([401, 402, 403, 429])('stops immediately on provider status %i and cleans frames', async status => {
    const error = new OpenAIError('Provider blocked', status); mocks.chat.mockRejectedValue(error)
    await expect(rankEditorialCandidates(options())).rejects.toBe(error)
    expect(mocks.chat).toHaveBeenCalledTimes(1)
    for (const dir of frameDirs) await expect(readdir(dir)).rejects.toThrow()
  })

  it('propagates subscription limits and cancellation', async () => {
    const error = new Error('Daily cap'); error.name = 'SubscriptionError'; mocks.chat.mockRejectedValue(error)
    await expect(rankEditorialCandidates(options())).rejects.toBe(error)
    const controller = new AbortController()
    mocks.chat.mockImplementation(() => { controller.abort(new Error('Cancelled')); throw new Error('Connection closed') })
    await expect(rankEditorialCandidates({ ...options(), signal: controller.signal })).rejects.toThrow('Cancelled')
  })

  it('bounds a large pool to eleven reviews plus one diversity call and counts excess candidates', async () => {
    const candidates = Array.from({ length: 45 }, (_, i) => clip(`c${i}`, i * 10, i * 10 + 6))
    const result = await rankEditorialCandidates(options(candidates))
    expect(result.report).toMatchObject({ candidateCount: 45, reviewedCount: 44, needsReviewCount: 1, reviewRequestCount: 11, diversityRequestCount: 1 })
    expect(mocks.chat).toHaveBeenCalledTimes(12)
    expect(result.clips).toHaveLength(45)
  })

  it('does not hide a failed diversity pass or remove otherwise reviewed candidates', async () => {
    const original = mocks.chat.getMockImplementation()!
    mocks.chat.mockImplementation((...args) => args[3] === 'editorial_diversity' ? Promise.reject(new Error('Outage')) : original(...args))
    const result = await rankEditorialCandidates(options([clip('a'), clip('b', 10, 16)]))
    expect(result.report.diversityStatus).toBe('failed'); expect(result.clips).toHaveLength(2)
  })

  it('refuses a snapshot if the source was changed during review', async () => {
    const original = mocks.chat.getMockImplementation()!
    mocks.chat.mockImplementation(async (...args) => { await writeFile(source, `${await readFile(source, 'utf8')}changed`); return original(...args) })
    await expect(rankEditorialCandidates(options())).rejects.toThrow('source changed')
  })
})
