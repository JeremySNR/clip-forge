import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Clip, Transcript, VideoInfo } from '@shared/types'
import { DEFAULT_SUBSCRIPTION, MAX_SUBSCRIPTION_IMAGES } from '@shared/subscription'
import { EDITORIAL_BUDGET } from '@shared/editorialRanking'
import { SOURCE_DISCOVERY_BUDGET } from '@shared/sourceAnalysis'

const mock = vi.hoisted(() => ({ root: '', spawn: vi.fn(), frames: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => mock.root, getAppPath: () => mock.root, isPackaged: false,
  once: vi.fn(), removeListener: vi.fn() } }))
vi.mock('node:child_process', () => ({ spawn: mock.spawn }))
vi.mock('../src/main/pipeline/visualScore', async importOriginal => ({
  ...await importOriginal<typeof import('../src/main/pipeline/visualScore')>(), extractFramesAtTimes: mock.frames
}))
// These imports deliberately remain real: requests must cross the actual subscription image serializer.
import { configureSubscription, subscriptionJSON } from '../src/main/subscription'
import { rankEditorialCandidates } from '../src/main/pipeline/editorialReview'
import { discoverSourceMoments } from '../src/main/pipeline/sourceDiscovery'

interface SerializedCall { imageCount: number; imageBytes: number[]; prompt: string; schema: { properties: Record<string, unknown> } }
let calls: SerializedCall[], video: VideoInfo, transcript: Transcript

function candidate(id: string, start: number): Clip {
  return { id, suggestedStart: start, suggestedEnd: start + 6, title: 'Untrusted generated title', hook: '', summary: '',
    viralityScore: 70, viralityReason: '', visualSummary: null, hashtags: [], thumbnailPath: null, focusTrack: null, broll: [],
    edit: { start, end: start + 6, aspect: '9:16', reframeMode: 'fit-letterbox', framing: 'auto', focusX: .5,
      tightenCuts: false, captionsEnabled: false, captionStyleId: 'beast', showTitle: false } }
}

function serializedResponse(call: SerializedCall): unknown {
  if ('reviews' in call.schema.properties) {
    const inputs = call.prompt.split('\n').filter(line => line.startsWith('{"id":')).map(line => JSON.parse(line) as { id: string })
    return { reviews: inputs.map(input => {
      const times = [...call.prompt.matchAll(new RegExp(`${input.id} selected frame at ([\\d.]+)s`, 'g'))].map(match => Number(match[1]))
      return { id: input.id, story: 'complete', fidelity: 'supported', scores: { hook: 3, clarity: 3, value: 3, payoff: 3, audienceFit: null },
        reason: 'The sampled action and result make a complete demonstration.', concerns: [], takeaway: `Demonstration ${input.id}`,
        evidence: [{ kind: 'frame', time: times[0], quote: 'The object is being prepared.' },
          { kind: 'frame', time: times.at(-1), quote: 'The visible result is present.' }] }
    }) }
  }
  if ('repeated' in call.schema.properties) return { repeated: [] }
  if ('proposals' in call.schema.properties) return { proposals: [{
    start_frame: 1, end_frame: 5, title: 'The fold holds the weight', summary: 'The folded paper holds a weight above a gap.',
    reason: 'The setup, action and result show a useful technique.', score: 75, kind: 'demonstration',
    observable_change: true, complete_event: true, evidence: [
      { frame: 1, role: 'before', observation: 'The paper lies flat.' },
      { frame: 2, role: 'action', observation: 'The folded paper spans a gap.' },
      { frame: 5, role: 'result', observation: 'The folded paper supports the weight.' }
    ]
  }] }
  return { accepted: true }
}

beforeEach(async () => {
  mock.root = await mkdtemp(join(tmpdir(), 'cutawan-subscription-vision-'))
  calls = []
  video = { path: join(mock.root, 'source.mp4'), fileName: 'source.mp4', durationSec: 600, width: 640, height: 360,
    fps: 30, hasAudio: false, sizeBytes: 20 }
  transcript = { language: 'und', durationSec: 600, segments: [], speech: [] }
  await writeFile(video.path, 'Synthetic source bytes; extraction is stubbed')
  mock.frames.mockReset().mockImplementation(async (_source: string, times: number[]) => {
    const dir = await mkdtemp(join(mock.root, 'frames-'))
    return Promise.all(times.map(async (_time, i) => {
      const path = join(dir, `${i}.jpg`); await writeFile(path, `scripted-frame-${i}`); return path
    }))
  })
  mock.spawn.mockReset().mockImplementation((_exe: string, args: string[]) => {
    let prompt = ''
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end: vi.fn((input: string) => { prompt = input }) }), kill: vi.fn() })
    setTimeout(() => { void (async () => {
      if (args[0] === 'login') child.stderr.emit('data', 'Logged in using ChatGPT')
      else {
        const paths = args.flatMap((arg, index) => arg === '--image' ? [args[index + 1]] : [])
        const call: SerializedCall = { imageCount: paths.length, prompt,
          imageBytes: await Promise.all(paths.map(async path => (await readFile(path)).length)),
          schema: JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1], 'utf8')) }
        calls.push(call)
        await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(serializedResponse(call)))
      }
      child.emit('close', 0)
    })().catch(error => child.emit('error', error)) }, 0)
    return child
  })
  // Isolated test preferences only: never mutate a saved user's request cap.
  configureSubscription({ ...DEFAULT_SUBSCRIPTION, provider: 'chatgpt', dailyRequestLimit: 100 })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No API fallback is allowed in subscription tests') }))
})
afterEach(async () => {
  configureSubscription(DEFAULT_SUBSCRIPTION)
  vi.unstubAllGlobals()
  await rm(mock.root, { recursive: true, force: true })
})

describe('visual pipelines through the real ChatGPT serializer', () => {
  it('serializes and refines discovery within the unchanged ten-image limit', async () => {
    const report = await discoverSourceMoments({ videoPath: video.path, durationSec: 60, transcript: null,
      apiKey: '', model: 'unused-api-model', providerCacheKey: 'chatgpt:test-model:low', prompt: '',
      maxClipDurationSec: 45, cacheDir: join(mock.root, 'discovery-cache') })
    expect(report).toMatchObject({ status: 'complete', successfulWindowCount: 1, successfulRefinementCount: 1,
      configuration: { version: 'source-discovery-2', provider: 'chatgpt' } })
    expect(report.candidates).toHaveLength(1)
    expect(calls.map(call => call.imageCount)).toEqual([SOURCE_DISCOVERY_BUDGET.framesPerWindow, MAX_SUBSCRIPTION_IMAGES])
    expect(calls.flatMap(call => call.imageBytes).every(size => size > 0)).toBe(true)
    expect(calls[1].prompt).toContain('[Attached image 10]')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('splits a full editorial pool into at most eight images per ChatGPT call without losing candidates', async () => {
    const candidates = Array.from({ length: 45 }, (_, i) => candidate(`c${i}`, i * 10))
    const result = await rankEditorialCandidates({ video, transcript, sourceRevision: 0, clips: candidates,
      baselineClips: candidates, apiKey: '', model: 'unused-api-model', providerCacheKey: 'chatgpt:test-model:low', prompt: '' })
    expect(result.report).toMatchObject({ candidateCount: 45, reviewedCount: 44, needsReviewCount: 1,
      reviewRequestCount: 22, diversityRequestCount: 1, diversityStatus: 'complete', provider: 'chatgpt' })
    expect(result.clips).toHaveLength(45)
    const reviews = calls.filter(call => 'reviews' in call.schema.properties)
    expect(reviews).toHaveLength(EDITORIAL_BUDGET.maxReviewCalls)
    expect(reviews.every(call => call.imageCount === 8 && call.imageBytes.every(size => size > 0))).toBe(true)
    expect(calls.every(call => call.imageCount <= MAX_SUBSCRIPTION_IMAGES)).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still rejects requests over the adapter image limit before inference', async () => {
    const content = Array.from({ length: MAX_SUBSCRIPTION_IMAGES + 1 }, () => ({ type: 'image_url' as const,
      image_url: { url: 'data:image/jpeg;base64,aW1hZ2U=' } }))
    await expect(subscriptionJSON([{ role: 'user', content }], { type: 'object', properties: {} })).rejects.toThrow('Unsupported image input')
    expect(calls).toHaveLength(0)
    expect(mock.spawn.mock.calls.filter(call => call[1][0] === 'exec')).toHaveLength(0)
  })
})
