import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Script } from 'node:vm'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { reviewDimensions, type ReviewIndex } from '../src/shared/qualityReview'
import type { Clip } from '../src/shared/types'
import type { EditorialRankingReport } from '../src/shared/editorialRanking'

const exec = promisify(execFile)
let dir: string
const cli = (...args: string[]) => exec(process.execPath,
  ['--import', 'tsx', 'scripts/quality-benchmark.ts', ...args],
  { cwd: process.cwd(), env: { ...process.env, TSX_TSCONFIG_PATH: 'tsconfig.node.json' } })

describe('offline quality experiment', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cutawan-benchmark-'))
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1:r=10',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'source.mp4')])
  })
  afterAll(async () => {
    if (dirname(resolve(dir)) !== resolve(tmpdir())) throw new Error('Unexpected test cleanup path')
    await rm(dir, { recursive: true, force: true })
  })

  it('checks media, evaluates predictions and prepares anonymously named playable copies', async () => {
    const media = await readFile(join(dir, 'source.mp4'))
    const reference = { sourceSha256: createHash('sha256').update(media).digest('hex'), durationSec: 1,
      words: [{ text: 'hello', start: 0.1, end: 0.5 }], highlights: [{ start: 0, end: 1 }] }
    await writeFile(join(dir, 'reference.json'), JSON.stringify(reference))
    await writeFile(join(dir, 'predictions.json'), JSON.stringify({ schemaVersion: 1,
      provenance: { system: 'Synthetic test only', revision: 'fixture', configuration: 'No model measured' },
      cases: { demo: reference }, renders: [{ caseId: 'demo', path: 'source.mp4' }] }))
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1,
      cases: [{ id: 'demo', split: 'test', tags: ['synthetic'], reference: 'reference.json', source: 'source.mp4' }],
      runs: [{ id: 'fixture-system', predictions: 'predictions.json' }] }))
    const output = join(dir, 'experiment')
    await cli('compare', join(dir, 'manifest.json'), output)
    const report = JSON.parse(await readFile(join(output, 'metrics.json'), 'utf8'))
    expect(report.results[0].cases[0].metrics.words.wordErrorRate).toBe(0)
    expect(report.results[0].cases[0].metrics.speakers).toBeNull()
    const key = JSON.parse(await readFile(join(output, 'private-key.json'), 'utf8'))
    expect(key[0].runId).toBe('fixture-system')
    expect(await readFile(join(output, `${key[0].id}.mp4`))).toEqual(media)
    const html = await readFile(join(output, 'review.html'), 'utf8')
    expect(html).toContain('Download ratings')
    expect(() => new Script(html.match(/<script>([\s\S]*?)<\/script>/)![1])).not.toThrow()
    expect(html).not.toContain('fixture-system')
    expect(html).toContain('Original source')
    expect(html).toContain('Measured repair seconds')
    const index = JSON.parse(await readFile(join(output, 'review-index.json'), 'utf8')) as ReviewIndex
    expect(index.slots).toHaveLength(5)
    expect(index.slots.filter((s) => s.status === 'not-returned')).toHaveLength(4)
    for (const reviewer of ['first', 'second']) {
      await writeFile(join(dir, `${reviewer}.json`), JSON.stringify({ schemaVersion: 2, experimentId: index.experimentId, reviewer,
        ratings: [{ id: key[0].id, verdict: 'publishable', repairSeconds: 0, sourceCompared: true,
          severeDefects: [], scores: Object.fromEntries(reviewDimensions.map((d) => [d, 4])), notes: '' }] }))
    }
    const summaryPath = join(dir, 'review-summary.json')
    await cli('summarize-review', output, summaryPath, join(dir, 'first.json'), join(dir, 'second.json'))
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'))
    expect(summary.runs[0].summary).toMatchObject({ publishable: 1, publishableAmongReviewed: 1, publishablePerTopKSlot: 0.2,
      missingOutputSlots: 4, fullyReviewed: 1, medianRepairSeconds: 0 })
    await expect(cli('summarize-review', output, join(dir, 'duplicate-summary.json'), join(dir, 'first.json'), join(dir, 'first.json'))).rejects.toThrow('Duplicate reviewer')
    await expect(cli('compare', join(dir, 'manifest.json'), output)).rejects.toThrow()
  }, 30_000)

  it('records missing renders and explicit empty output without dropping cases', async () => {
    const sample = { sourceSha256: 'a'.repeat(64), durationSec: 1, highlights: [{ start: 0, end: 1 }] }
    await writeFile(join(dir, 'coverage-ref.json'), JSON.stringify(sample))
    await writeFile(join(dir, 'coverage-predictions.json'), JSON.stringify({ schemaVersion: 1,
      provenance: { system: 'Synthetic only', revision: 'fixture', configuration: 'No model' },
      cases: { missing: sample, empty: { ...sample, highlights: [] } },
      renders: [{ caseId: 'missing', rank: 1, path: 'does-not-exist.mp4' }] }))
    await writeFile(join(dir, 'coverage-manifest.json'), JSON.stringify({ schemaVersion: 1, topK: 2,
      cases: ['missing', 'empty'].map((id) => ({ id, split: 'test', tags: ['synthetic'], reference: 'coverage-ref.json' })),
      runs: [{ id: 'fixture', predictions: 'coverage-predictions.json' }] }))
    const output = join(dir, 'coverage-experiment')
    await cli('compare', join(dir, 'coverage-manifest.json'), output)
    await cli('summarize-review', output, join(dir, 'empty-review-summary.json'))
    const summary = JSON.parse(await readFile(join(dir, 'empty-review-summary.json'), 'utf8'))
    expect(summary.runs[0].summary).toMatchObject({ eligibleTopKSlots: 4, returned: 1, missingRenders: 1, missingOutputSlots: 3,
      rendered: 0, fullyReviewed: 0, publishable: 0, publishableAmongReviewed: null })
    expect(summary.runs[0].cases).toHaveLength(2)
    const metrics = JSON.parse(await readFile(join(output, 'metrics.json'), 'utf8'))
    expect(metrics.renderWarnings).toHaveLength(1)
  }, 30_000)

  it('exports stored transcript and clip decisions without inventing speaker labels', async () => {
    const projectPath = join(dir, 'project.json')
    await writeFile(projectPath, JSON.stringify({ video: { path: join(dir, 'source.mp4'), durationSec: 1 },
      transcript: { segments: [{ words: [{ text: '', sourceText: 'hello', start: 0.1, end: 0.5 }] }] },
      clips: [{ viralityScore: 80, discovery: { origin: 'visual', evidenceTimes: [0.2, 0.7] }, edit: { start: 0, end: 1 } }] }))
    const output = join(dir, 'exported.json')
    await cli('export-project', projectPath, 'demo', output)
    const run = JSON.parse(await readFile(output, 'utf8'))
    expect(run.cases.demo.words[0].text).toBe('hello')
    expect(run.cases.demo.speakers).toBeUndefined()
    expect(run.cases.demo.highlights).toEqual([{ start: 0, end: 1 }])
    expect(run.discovery.demo.candidates).toEqual([{ rank: 1, origin: 'visual', evidenceTimes: [0.2, 0.7] }])
    expect(run.discovery.demo.report).toBeUndefined()
  }, 30_000)

  it('freezes exact two-arm decisions and renders the saved pool despite later project edits', async () => {
    const clip = (id: string, score: number, start: number, end: number): Clip => ({
      id, suggestedStart: start, suggestedEnd: end, title: id, hook: '', summary: id,
      viralityScore: score, viralityReason: 'Synthetic only', visualSummary: null, hashtags: [],
      thumbnailPath: null, focusTrack: null, broll: [], reframeStatus: 'pending',
      visualStory: { protectedRanges: [{ start, end }], reason: 'Preserve test action' },
      edit: { aspect: 'original', reframeMode: 'fit-letterbox', framing: 'manual', tightenCuts: false,
        autoZoom: false, focusX: .5, captionsEnabled: false, captionStyleId: 'beast', showTitle: false, start, end }
    })
    const candidates = [clip('higher-legacy', 90, 0, .6), clip('higher-editorial', 50, .4, 1)]
    const report: EditorialRankingReport = {
      version: 1, recipe: 'editorial-1', createdAt: '2026-09-25T00:00:00Z',
      sourceSha256: createHash('sha256').update(await readFile(join(dir, 'source.mp4'))).digest('hex'), sourceRevision: 1,
      model: 'synthetic-no-model', provider: 'api', effectiveModel: null, prompt: 'Synthetic only',
      video: { path: join(dir, 'source.mp4'), fileName: 'source.mp4', durationSec: 1, width: 160, height: 90, fps: 10,
        hasAudio: false, sizeBytes: (await readFile(join(dir, 'source.mp4'))).length },
      transcript: { durationSec: 1, language: 'en', segments: [], speech: [] }, candidates,
      baseline: { recipe: 'legacy-60-40-overlap-v1', clips: candidates }, rankedSnapshot: [...candidates].reverse(),
      assessments: [], candidateCount: 2, reviewedCount: 0, needsReviewCount: 2, rejectedCount: 0,
      suppressedOverlapCount: 0, duplicateDeferredCount: 0, reviewRequestCount: 0, diversityRequestCount: 0,
      diversityStatus: 'not-needed', limitations: ['Synthetic fixture, not human results']
    }
    const projectPath = join(dir, 'ranked-project.json'), frozen = join(dir, 'frozen-ranking'), rendered = join(dir, 'rendered-ranking')
    await writeFile(projectPath, JSON.stringify({ video: report.video, transcript: report.transcript,
      clips: [...candidates].reverse(), editorialRanking: report }))
    const currentOutput = join(dir, 'current-editorial.json')
    await cli('export-project', projectPath, 'demo', currentOutput)
    expect(JSON.parse(await readFile(currentOutput, 'utf8')).cases.demo.highlights[0]).toEqual({ start: .4, end: 1 })
    await cli('export-ranking', projectPath, 'demo', frozen)
    const snapshot = JSON.parse(await readFile(join(frozen, 'snapshot.json'), 'utf8'))
    expect(snapshot.report.candidates[0].visualStory).toEqual(candidates[0].visualStory)
    expect(snapshot.report.candidates[0].edit).toEqual(candidates[0].edit)
    expect(JSON.parse(await readFile(join(frozen, 'baseline.json'), 'utf8')).ranking.demo.rankedIds).toEqual(['higher-legacy', 'higher-editorial'])
    expect(JSON.parse(await readFile(join(frozen, 'editorial.json'), 'utf8')).ranking.demo.rankedIds).toEqual(['higher-editorial', 'higher-legacy'])
    await writeFile(projectPath, JSON.stringify({ video: report.video, clips: [], transcript: null }))
    await cli('render-ranking', frozen, rendered, '3')
    const renders = JSON.parse(await readFile(join(rendered, 'render-report.json'), 'utf8'))
    expect(renders.outcomes.filter((o: { status: string }) => o.status === 'rendered')).toHaveLength(4)
    expect(renders.outcomes.filter((o: { status: string }) => o.status === 'not-returned')).toHaveLength(2)
    expect(renders.outcomes[0]).toMatchObject({ arm: 'baseline', clipId: 'higher-legacy', rank: 1, status: 'rendered' })
    expect(renders.outcomes[3]).toMatchObject({ arm: 'editorial', clipId: 'higher-editorial', rank: 1, status: 'rendered' })
    const renderedPrediction = JSON.parse(await readFile(join(rendered, 'editorial.json'), 'utf8'))
    expect(renderedPrediction.renders[0].declaredReady).toBeUndefined()
    expect(renderedPrediction.cases.demo.highlights[0]).toEqual({ start: .4, end: 1 })
    await expect(cli('render-ranking', frozen, rendered)).rejects.toThrow()
    // One real render failure must remain a missing path, without erasing the successful arm.
    for (const clips of [report.candidates, report.baseline.clips, report.rankedSnapshot]) {
      clips.find(c => c.id === 'higher-legacy')!.edit.cuts = [{ start: 0, end: .6 }]
    }
    await writeFile(projectPath, JSON.stringify({ editorialRanking: report }))
    const failingFrozen = join(dir, 'failing-frozen'), failingRendered = join(dir, 'failing-rendered')
    await cli('export-ranking', projectPath, 'demo', failingFrozen)
    await cli('render-ranking', failingFrozen, failingRendered, '1')
    const failures = JSON.parse(await readFile(join(failingRendered, 'render-report.json'), 'utf8'))
    expect(failures.outcomes.map((o: { status: string }) => o.status)).toEqual(['failed', 'rendered'])
    expect(JSON.parse(await readFile(join(failingRendered, 'baseline.json'), 'utf8')).renders).toEqual([
      { caseId: 'demo', rank: 1, path: 'baseline-1.mp4' }
    ])
    snapshot.report.rankedSnapshot.reverse()
    await writeFile(join(frozen, 'snapshot.json'), JSON.stringify(snapshot))
    await expect(cli('render-ranking', frozen, join(dir, 'tampered-ranking'))).rejects.toThrow('checksum changed')
    snapshot.report.rankedSnapshot.reverse()
    snapshot.report.video.path = join(dir, 'changed-source.mp4')
    await writeFile(snapshot.report.video.path, 'changed bytes')
    snapshot.snapshotSha256 = createHash('sha256').update(JSON.stringify(snapshot.report)).digest('hex')
    await writeFile(join(frozen, 'snapshot.json'), JSON.stringify(snapshot))
    await expect(cli('render-ranking', frozen, join(dir, 'changed-source-ranking'))).rejects.toThrow('Source bytes no longer match')
  }, 30_000)

  it('refuses to manufacture a frozen baseline for legacy projects', async () => {
    const projectPath = join(dir, 'legacy-project.json')
    await writeFile(projectPath, JSON.stringify({ video: { path: join(dir, 'source.mp4') }, clips: [] }))
    await expect(cli('export-ranking', projectPath, 'demo', join(dir, 'fabricated-ranking'))).rejects.toThrow('frozen editorial ranking report')
  }, 30_000)
})
