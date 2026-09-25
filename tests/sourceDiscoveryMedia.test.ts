import { beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SOURCE_DISCOVERY_BUDGET } from '@shared/sourceAnalysis'

vi.mock('../src/main/pipeline/mediaJobs', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/main/pipeline/mediaJobs')>()
  return { ...actual, mediaJobs: new actual.MediaQueue(() => 1) }
})
const mock = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('../src/main/pipeline/openai', async importOriginal => ({
  ...await importOriginal<typeof import('../src/main/pipeline/openai')>(),
  chatJSON: mock.chat, chatApiBase: () => 'https://test.invalid/v1'
}))
vi.mock('../src/main/subscription', () => ({ usesSubscription: () => false, throwIfSubscriptionError: () => undefined }))
vi.mock('electron', () => ({ app: undefined }))
import { probeVideo, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { discoverSourceMoments } from '../src/main/pipeline/sourceDiscovery'
import { visualCandidateClip } from '../src/main/pipeline/visualCandidates'
import { renderClip } from '../src/main/pipeline/render'

beforeEach(() => { mock.chat.mockReset().mockResolvedValue({ proposals: [] }) })

it('extracts source frames with a single media slot without nested admission deadlocks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cutawan-discovery-media-'))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Discovery deadlocked in media admission')), 8000)
  try {
    const path = join(root, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=96x54:r=3:d=2', '-c:v', 'mpeg4', path], { signal: controller.signal })
    const result = await discoverSourceMoments({ videoPath: path, durationSec: 2, transcript: null, apiKey: 'unused',
      model: 'mocked', prompt: '', maxClipDurationSec: 10, cacheDir: join(root, 'cache'), signal: controller.signal })
    expect(result).toMatchObject({ status: 'complete', successfulWindowCount: 1, failedWindowCount: 0, analysisRequestCount: 1, candidates: [] })
  } finally {
    clearTimeout(timeout)
    await rm(root, { recursive: true, force: true })
  }
}, 10_000)

it('exports a discovered silent event through real FFmpeg without fabricating captions or an audio stream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cutawan-discovery-export-'))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Silent discovery/export timed out')), 15_000)
  try {
    const path = join(root, 'silent-pattern.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=3:d=8', '-c:v', 'mpeg4', path], { signal: controller.signal })
    mock.chat.mockImplementation(async (_key, _model, _messages, schemaName) => {
      const end = (schemaName === 'source_event_discovery'
        ? SOURCE_DISCOVERY_BUDGET.framesPerWindow : SOURCE_DISCOVERY_BUDGET.framesPerRefinement) - 1
      return { proposals: [{ start_frame: 0, end_frame: end, title: 'Changing test pattern', summary: 'A synthetic pattern changes over time.',
        reason: 'Offline scripted candidate for end-to-end media validation, not an editorial-quality judgement.',
        score: 50, kind: 'visual-story', observable_change: true, complete_event: true,
        evidence: [{ frame: 0, role: 'action', observation: 'The test pattern appears in its initial position.' },
          { frame: end, role: 'result', observation: 'The pattern has visibly moved to a later position.' }] }] }
    })
    const source = await probeVideo(path)
    expect(source.hasAudio).toBe(false)
    const report = await discoverSourceMoments({ videoPath: path, durationSec: source.durationSec, transcript: null,
      apiKey: 'unused', model: 'mocked', prompt: '', maxClipDurationSec: 10, cacheDir: join(root, 'cache'), signal: controller.signal })
    expect(report.candidates).toHaveLength(1)
    const emptyTranscript = { language: 'und', durationSec: source.durationSec, segments: [] }
    const clip = visualCandidateClip(report.candidates[0], emptyTranscript, source.durationSec, 10)!
    expect(clip.edit.captionsEnabled).toBe(false)
    expect(clip.edit.tightenCuts).toBe(false)
    expect(clip.edit.reframeMode).toBe('fit-letterbox')
    const rendered = await renderClip({ clip, source, transcript: emptyTranscript,
      outputPath: join(root, 'export.mp4'), encoder: 'cpu', quality: 'draft', signal: controller.signal })
    const output = await probeVideo(rendered.outputPath)
    expect(output).toMatchObject({ width: 1080, height: 1920, hasAudio: false })
    expect(output.durationSec).toBeCloseTo(clip.edit.end - clip.edit.start, 1)
    expect(rendered.bytes).toBeGreaterThan(0)
  } finally {
    clearTimeout(timeout)
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
