/** Offline model comparison and export of the current application's saved results. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, constants } from 'node:fs'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import type { Clip, Project } from '../src/shared/types'
import type { EditorialRankingReport } from '../src/shared/editorialRanking'
import { evaluateQuality, validateQualitySample, type QualitySample } from '../src/shared/qualityBenchmark'
import { aggregateQualityReviews, reviewDimensions, severeDefects, validateReviewCases, validateReviewIndex,
  type ReviewCase, type ReviewIndex, type ReviewSlot } from '../src/shared/qualityReview'

interface Manifest {
  schemaVersion: 1
  topK?: number
  iouThreshold?: number
  minimumReviewers?: number
  cases: Array<{ id: string; split: 'development' | 'test'; tags: string[]; reference: string; source?: string; creatorGroup?: string; recordingGroup?: string }>
  runs: Array<{ id: string; predictions: string }>
}
interface Predictions {
  schemaVersion: 1
  provenance: { system: string; revision: string; configuration: string }
  cases: Record<string, QualitySample>
  renders?: Array<{ caseId: string; path: string; rank?: number; declaredReady?: boolean }>
  /** Self-reported discovery provenance, never human reference labels. */
  discovery?: Record<string, { report?: Project['discoveryReport']; candidates: Array<{
    rank: number; origin: 'transcript' | 'visual' | 'unknown'; evidenceTimes?: number[]
  }> }>
  ranking?: Record<string, { recipe: string; snapshotSha256: string; candidateIds: string[]; rankedIds: string[];
    reviewedCount: number; needsReviewCount: number; rejectedCount: number; limitations: string[] }>
}

async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')) as unknown }
async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
}
function uniqueIds(items: Array<{ id: string }>, label: string): void {
  if (!Array.isArray(items) || !items.length || items.some((x) => !x || typeof x.id !== 'string' || !x.id.trim()) ||
    new Set(items.map((x) => x.id)).size !== items.length) throw new Error(`${label} need nonempty, unique IDs`)
}

interface ReviewRender { slot: ReviewSlot; path: string; start?: number; end?: number }

async function compare(manifestPath: string, outputDir: string): Promise<void> {
  const manifest = await json(manifestPath) as Manifest
  if (!manifest || manifest.schemaVersion !== 1) throw new Error('Unsupported manifest version')
  uniqueIds(manifest.cases, 'Cases')
  uniqueIds(manifest.runs, 'Runs')
  const topK = manifest.topK ?? 5, minimumReviewers = manifest.minimumReviewers ?? 2
  if (!Number.isInteger(topK) || topK < 1 || topK > 100) throw new Error('topK must be an integer from 1 to 100')
  if (!Number.isInteger(minimumReviewers) || minimumReviewers < 2) throw new Error('minimumReviewers must be at least two')
  const base = dirname(manifestPath)
  const references = new Map<string, QualitySample>()
  const reviewCases: ReviewCase[] = []
  const sources = new Map<string, string>()
  for (const entry of manifest.cases) {
    const ref = await json(resolve(base, entry.reference))
    validateQualitySample(ref)
    if (entry.source) {
      const sourcePath = resolve(base, entry.source)
      if (await sha256(sourcePath) !== ref.sourceSha256.toLowerCase()) throw new Error(`${entry.id}: source hash does not match the reference`)
      sources.set(entry.id, sourcePath)
    }
    references.set(entry.id, ref)
    reviewCases.push({ id: entry.id, split: entry.split, tags: entry.tags, sourceSha256: ref.sourceSha256,
      creatorGroup: entry.creatorGroup, recordingGroup: entry.recordingGroup })
  }
  const splitIntegrity = validateReviewCases(reviewCases)
  const reviewIndex: ReviewIndex = { schemaVersion: 2, experimentId: randomUUID(), topK, minimumReviewers,
    cases: reviewCases, runs: manifest.runs.map((r) => r.id), slots: [] }
  const renders: ReviewRender[] = [], renderWarnings: string[] = []
  const results = []
  for (const entry of manifest.runs) {
    const predictionPath = resolve(base, entry.predictions)
    const run = await json(predictionPath) as Predictions
    if (!run || run.schemaVersion !== 1 || !run.cases || Array.isArray(run.cases) || !run.provenance ||
      [run.provenance.system, run.provenance.revision, run.provenance.configuration].some((v) => typeof v !== 'string' || !v.trim())) {
      throw new Error(`${entry.id}: predictions require version, provenance, and cases`)
    }
    if (Object.keys(run.cases).some((id) => !references.has(id))) throw new Error(`${entry.id}: predictions contain an unknown case`)
    const cases = manifest.cases.map((c) => {
      if (!run.cases[c.id]) throw new Error(`${entry.id}: missing case ${c.id}; do not omit difficult cases`)
      return { id: c.id, split: c.split, tags: c.tags,
        metrics: evaluateQuality(references.get(c.id)!, run.cases[c.id], topK, manifest.iouThreshold),
        discovery: run.discovery?.[c.id] ?? null, ranking: run.ranking?.[c.id] ?? null }
    })
    results.push({ id: entry.id, provenance: run.provenance, cases })
    if (run.renders !== undefined && !Array.isArray(run.renders)) throw new Error(`${entry.id}: renders must be an array`)
    const rankedRenders = new Map<string, NonNullable<Predictions['renders']>[number]>()
    const nextRank = new Map<string, number>()
    for (const render of run.renders ?? []) {
      if (!render || !references.has(render.caseId) || typeof render.path !== 'string' || !render.path.trim()) throw new Error('Invalid render case or path')
      const inferredRank = (nextRank.get(render.caseId) ?? 0) + 1
      nextRank.set(render.caseId, inferredRank)
      const rank = render.rank ?? inferredRank
      if (!Number.isInteger(rank) || rank < 1) throw new Error('Render rank must be a positive 1-based integer')
      if (render.declaredReady !== undefined && typeof render.declaredReady !== 'boolean') throw new Error('declaredReady must be a boolean')
      const key = JSON.stringify([render.caseId, rank])
      if (rankedRenders.has(key)) throw new Error(`Duplicate render rank for ${render.caseId}`)
      if (run.cases[render.caseId].highlights && rank > run.cases[render.caseId].highlights!.length) throw new Error('Render rank exceeds returned highlight count')
      rankedRenders.set(key, render)
    }
    for (const c of manifest.cases) for (let rank = 1; rank <= topK; rank++) {
      const highlights = run.cases[c.id].highlights
      const render = rankedRenders.get(JSON.stringify([c.id, rank]))
      const slot: ReviewSlot = { id: randomUUID(), runId: entry.id, caseId: c.id, rank,
        status: highlights === undefined ? 'unknown-output' : rank <= highlights.length ? 'missing-render' : 'not-returned' }
      if (render) {
        const path = resolve(dirname(predictionPath), render.path)
        if (!['.mp4', '.webm', '.mov', '.m4v'].includes(extname(path).toLowerCase())) throw new Error('Review renders must be local video files')
        slot.status = 'missing-render'
        slot.declaredReady = render.declaredReady
        try {
          const file = await stat(path)
          if (!file.isFile() || !file.size) throw new Error('not a nonempty regular file')
          slot.status = 'rendered'
          renders.push({ slot, path, start: highlights?.[rank - 1]?.start, end: highlights?.[rank - 1]?.end })
        } catch (error) {
          renderWarnings.push(`${entry.id}/${c.id}/rank ${rank}: missing or unreadable render (${error instanceof Error ? error.message : String(error)})`)
        }
      }
      reviewIndex.slots.push(slot)
    }
  }
  validateReviewIndex(reviewIndex)
  // A new directory prevents overwriting a previous experiment or its blind key.
  await mkdir(dirname(outputDir), { recursive: true })
  await mkdir(outputDir)
  await writeJson(resolve(outputDir, 'metrics.json'), {
    schemaVersion: 1, createdAt: new Date().toISOString(),
    protocol: { topK, iouThreshold: manifest.iouThreshold ?? 0.5,
      diarization: 'zero collar, overlap included, canonical speaker IDs supplied by adapters',
      missingMetric: 'null means not evaluated; it is never a zero-error result',
      interpretation: 'No composite quality or virality score. Judge exported videos blind; report held-out cases separately.' },
    splitIntegrity, renderWarnings, results
  })
  await prepareReview(outputDir, reviewIndex, renders, sources)
  await writeJson(resolve(outputDir, 'review-coverage.json'), aggregateQualityReviews(reviewIndex, []))
  console.log(`Compared ${manifest.runs.length} runs on ${manifest.cases.length} cases: ${resolve(outputDir, 'metrics.json')}`)
  console.log(renders.length ? 'Blind video review: review.html (keep private-key.json, review-index.json and metrics hidden from reviewers).' :
    'No rendered videos available. Coverage is recorded; final video quality and engagement have NOT been evaluated.')
  for (const warning of [...splitIntegrity.warnings, ...renderWarnings]) console.warn(warning)
}

async function exportProject(projectPath: string, caseId: string, outputPath: string): Promise<void> {
  const project = await json(projectPath) as Project
  if (!project.video || !Array.isArray(project.clips)) throw new Error('Expected a saved Cutawan project.json')
  const rankedClips = project.clips.filter((c) => c.origin !== 'whole-video')
  // New projects persist editorial ordering; re-sorting would restore the old score by accident.
  if (!project.editorialRanking) rankedClips.sort((a, b) => b.viralityScore - a.viralityScore)
  const sample = projectSample(project, rankedClips, await sha256(project.video.path))
  await writeJson(outputPath, {
    schemaVersion: 1,
    provenance: { system: 'Cutawan saved project', revision: 'unrecorded in project',
      configuration: 'Saved edits and ranking; record actual model/settings/revision before a controlled comparison. No speaker IDs are inferred from crop positions.' },
    cases: { [caseId]: sample },
    discovery: { [caseId]: discoveryProvenance(project, rankedClips) }
  } satisfies Predictions)
  console.log(`Exported ${outputPath}. Speaker identity and visual-target metrics remain unavailable until labelled outputs are supplied.`)
}

function projectSample(project: Pick<Project, 'video' | 'transcript'>, clips: Clip[], sourceSha256: string): QualitySample {
  const sample: QualitySample = {
    sourceSha256, durationSec: project.video.durationSec,
    words: project.transcript?.segments.flatMap((s) => s.words.map((w) => ({
      text: w.sourceText ?? w.text, start: w.start, end: w.end
    }))).sort((a, b) => a.start - b.start),
    highlights: clips.map((c) => ({ start: c.edit.start, end: c.edit.end }))
  }
  validateQualitySample(sample, true)
  return sample
}

function discoveryProvenance(project: Pick<Project, 'discoveryReport'>, clips: Clip[]): NonNullable<Predictions['discovery']>[string] {
  return {
    ...(project.discoveryReport ? { report: project.discoveryReport } : {}),
    candidates: clips.map((c, i) => ({ rank: i + 1, origin: c.discovery?.origin ?? 'unknown',
      ...(c.discovery?.evidenceTimes ? { evidenceTimes: c.discovery.evidenceTimes } : {}) }))
  }
}

interface RankingPackage {
  schemaVersion: 1
  caseId: string
  snapshotSha256: string
  report: EditorialRankingReport
  externalAssets: Array<{ path: string; sha256: string }>
}
function objectHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function clipInputHash(clip: Clip): string {
  const input = { ...clip }
  delete input.editorial
  return objectHash(input)
}
/** Frozen legacy recipe; intentionally independent of the current pipeline's selectors. */
function legacyBaselineIds(candidates: Clip[]): string[] {
  const kept: Clip[] = []
  for (const clip of [...candidates].sort((a, b) => b.viralityScore - a.viralityScore)) {
    const duration = clip.suggestedEnd - clip.suggestedStart
    if (kept.some(other => {
      const overlap = Math.min(clip.suggestedEnd, other.suggestedEnd) - Math.max(clip.suggestedStart, other.suggestedStart)
      return overlap > 0 && overlap / Math.min(duration, other.suggestedEnd - other.suggestedStart) > .4
    })) continue
    kept.push(clip)
  }
  return kept.map(c => c.id)
}

function validateRankingReport(value: unknown): asserts value is EditorialRankingReport {
  const report = value as EditorialRankingReport
  if (!report || report.version !== 1 || report.recipe !== 'editorial-1' ||
    report.baseline?.recipe !== 'legacy-60-40-overlap-v1' || !/^[a-f0-9]{64}$/i.test(report.sourceSha256) ||
    !report.video?.path || !report.transcript || !Array.isArray(report.transcript.segments) ||
    !Array.isArray(report.candidates) || !Array.isArray(report.baseline.clips) || !Array.isArray(report.rankedSnapshot)) {
    throw new Error('Expected a frozen editorial ranking report; generate clips with editorial review enabled first')
  }
  const ids = new Set<string>()
  const inputHashes = new Map<string, string>()
  for (const clip of report.candidates) {
    if (!clip || typeof clip.id !== 'string' || !clip.id || ids.has(clip.id) || clip.origin === 'whole-video' ||
      !clip.edit || !Number.isFinite(clip.viralityScore) || !Array.isArray(clip.broll) ||
      !Number.isFinite(clip.suggestedStart) || !Number.isFinite(clip.suggestedEnd) || clip.suggestedStart < 0 ||
      clip.suggestedEnd <= clip.suggestedStart || clip.suggestedEnd > report.video.durationSec) throw new Error('Invalid frozen candidate pool')
    ids.add(clip.id)
    inputHashes.set(clip.id, clipInputHash(clip))
  }
  if (report.candidateCount !== ids.size) throw new Error('Frozen candidate count does not match its pool')
  if (JSON.stringify(report.baseline.clips.map(c => c.id)) !== JSON.stringify(legacyBaselineIds(report.candidates))) {
    throw new Error('Frozen baseline does not match the fixed legacy score/overlap recipe')
  }
  for (const clips of [report.candidates, report.baseline.clips, report.rankedSnapshot]) {
    if (new Set(clips.map(c => c.id)).size !== clips.length || clips.some(c => !ids.has(c.id))) {
      throw new Error('Frozen ranking contains duplicate or unknown candidates')
    }
    if (clips.some(c => clipInputHash(c) !== inputHashes.get(c.id))) {
      throw new Error('Frozen ranking changed a candidate input; ranking-only arms must share identical edits')
    }
    projectSample(report, clips, report.sourceSha256)
  }
}

function rankingPredictions(pkg: RankingPackage, arm: 'baseline' | 'editorial'): Predictions {
  const report = pkg.report, clips = arm === 'baseline' ? report.baseline.clips : report.rankedSnapshot
  const recipe = arm === 'baseline' ? report.baseline.recipe : report.recipe
  return { schemaVersion: 1,
    provenance: { system: `Cutawan fixed-pool ${arm}`, revision: recipe,
      configuration: `Frozen snapshot ${pkg.snapshotSha256}; ${report.provider}/${report.effectiveModel ?? report.model}; same candidate pool, source and transcript. No human outcomes recorded.` },
    cases: { [pkg.caseId]: projectSample(report, clips, report.sourceSha256) },
    discovery: { [pkg.caseId]: discoveryProvenance({}, clips) },
    ranking: { [pkg.caseId]: { recipe, snapshotSha256: pkg.snapshotSha256,
      candidateIds: report.candidates.map(c => c.id), rankedIds: clips.map(c => c.id), reviewedCount: report.reviewedCount,
      needsReviewCount: report.needsReviewCount, rejectedCount: report.rejectedCount, limitations: report.limitations } } }
}

async function exportRanking(projectPath: string, caseId: string, outputDir: string): Promise<void> {
  if (!caseId.trim()) throw new Error('case-id must be nonempty')
  const project = await json(projectPath) as Project
  validateRankingReport(project.editorialRanking)
  const report = project.editorialRanking
  if (await sha256(report.video.path) !== report.sourceSha256) throw new Error('Source bytes no longer match the frozen ranking snapshot')
  const paths = new Set(report.candidates.flatMap(c => c.broll.filter(b => b.enabled && b.imagePath).map(b => b.imagePath!)))
  const externalAssets = await Promise.all([...paths].map(async path => ({ path, sha256: await sha256(path) })))
  const pkg: RankingPackage = { schemaVersion: 1, caseId, report, externalAssets, snapshotSha256: objectHash(report) }
  await mkdir(dirname(outputDir), { recursive: true })
  await mkdir(outputDir)
  await writeJson(resolve(outputDir, 'snapshot.json'), pkg)
  for (const arm of ['baseline', 'editorial'] as const) await writeJson(resolve(outputDir, `${arm}.json`), rankingPredictions(pkg, arm))
  await writeFile(resolve(outputDir, 'README.txt'),
    'Frozen same-pool ranking inputs and predictions. No renders or human results yet.\n' +
    'Run quality-benchmark.ts render-ranking <this-directory> <new-output-directory> [topK] to render both arms locally.\n' +
    'Add the resulting baseline.json/editorial.json to a benchmark manifest with independently annotated references.\n' +
    'This compares ranking on a shared pool, not historical pipeline discovery or OpusClip. Source media and B-roll must remain at their recorded paths.\n', { flag: 'wx' })
  console.log(`Frozen ${report.candidateCount} candidates in ${outputDir}. No renders or human quality results have been produced.`)
}

async function loadRankingPackage(inputDir: string): Promise<RankingPackage> {
  const pkg = await json(resolve(inputDir, 'snapshot.json')) as RankingPackage
  if (!pkg || pkg.schemaVersion !== 1 || typeof pkg.caseId !== 'string' || !pkg.caseId.trim() || !Array.isArray(pkg.externalAssets)) {
    throw new Error('Expected a frozen ranking package from export-ranking')
  }
  validateRankingReport(pkg.report)
  if (objectHash(pkg.report) !== pkg.snapshotSha256) throw new Error('Frozen ranking snapshot checksum changed; export a new experiment instead')
  if (await sha256(pkg.report.video.path) !== pkg.report.sourceSha256) throw new Error('Source bytes no longer match the frozen ranking snapshot')
  for (const asset of pkg.externalAssets) {
    if (!asset?.path || await sha256(asset.path) !== asset.sha256) throw new Error('A frozen B-roll asset changed or is unavailable')
  }
  const expectedAssets = new Set(pkg.report.candidates.flatMap(c => c.broll.filter(b => b.enabled && b.imagePath).map(b => b.imagePath!)))
  if (expectedAssets.size !== pkg.externalAssets.length || pkg.externalAssets.some(a => !expectedAssets.delete(a.path))) {
    throw new Error('Frozen B-roll asset inventory does not match the candidate pool')
  }
  return pkg
}

async function renderRanking(inputDir: string, outputDir: string, topK = 5): Promise<void> {
  if (!Number.isInteger(topK) || topK < 1 || topK > 100) throw new Error('topK must be an integer from 1 to 100')
  const pkg = await loadRankingPackage(inputDir)
  const { renderClip } = await import('../src/main/pipeline/render')
  await mkdir(dirname(outputDir), { recursive: true })
  await mkdir(outputDir)
  await writeJson(resolve(outputDir, 'snapshot.json'), pkg)
  const outcomes: Array<{ arm: string; rank: number; clipId?: string; status: 'rendered' | 'failed' | 'not-returned'; sha256?: string; error?: string }> = []
  const predictionOutputs: Array<{ arm: string; predictions: Predictions }> = []
  for (const arm of ['baseline', 'editorial'] as const) {
    const clips = arm === 'baseline' ? pkg.report.baseline.clips : pkg.report.rankedSnapshot
    const predictions = rankingPredictions(pkg, arm)
    predictions.renders = []
    predictions.provenance.configuration += ' Offline snapshot rendering: CPU, standard quality, bundled fonts, no branding, no new tracking/B-roll analysis.'
    for (let rank = 1; rank <= topK; rank++) {
      const clip = clips[rank - 1]
      if (!clip) { outcomes.push({ arm, rank, status: 'not-returned' }); continue }
      const filename = `${arm}-${rank}.mp4`, path = resolve(outputDir, filename)
      // Include failures as missing render paths, preserving full-slot coverage in compare.
      predictions.renders.push({ caseId: pkg.caseId, rank, path: filename })
      try {
        await renderClip({ clip: structuredClone(clip), source: pkg.report.video,
          transcript: pkg.report.transcript, outputPath: path, encoder: 'cpu', quality: 'standard', branding: null })
        outcomes.push({ arm, rank, clipId: clip.id, status: 'rendered', sha256: await sha256(path) })
      } catch (error) {
        outcomes.push({ arm, rank, clipId: clip.id, status: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
    }
    predictionOutputs.push({ arm, predictions })
  }
  const sourceUnchanged = await sha256(pkg.report.video.path) === pkg.report.sourceSha256
  const assetsUnchanged = (await Promise.all(pkg.externalAssets.map(async asset => await sha256(asset.path) === asset.sha256))).every(Boolean)
  await writeJson(resolve(outputDir, 'render-report.json'), { schemaVersion: 1, topK, snapshotSha256: pkg.snapshotSha256,
    sourceSha256: pkg.report.sourceSha256, sourceUnchanged, assetsUnchanged,
    rendererSha256: await sha256(resolve('src/main/pipeline/render.ts')), nodeVersion: process.version,
    settings: { encoder: 'cpu', quality: 'standard', branding: false, framing: 'frozen snapshot, no additional tracking' },
    limitations: ['Same-pool ranking experiment only; saved pending framing is rendered as captured.',
      'No human review, publishability claim or audience engagement has been measured.'], outcomes })
  if (!sourceUnchanged || !assetsUnchanged) throw new Error('Source or B-roll changed while rendering; no comparison predictions were exported')
  for (const { arm, predictions } of predictionOutputs) await writeJson(resolve(outputDir, `${arm}.json`), predictions)
  console.log(`Rendered ${outcomes.filter(o => o.status === 'rendered').length} clips; ${outcomes.filter(o => o.status === 'failed').length} failed; ${outcomes.filter(o => o.status === 'not-returned').length} unfilled slots. See ${resolve(outputDir, 'render-report.json')}`)
}

async function prepareReview(outputDir: string, index: ReviewIndex, renders: ReviewRender[], sources: Map<string, string>): Promise<void> {
  const shuffled = [...renders].sort((a, b) => a.slot.id.localeCompare(b.slot.id))
  const sourceNames = new Map<string, string>()
  for (const caseId of new Set(renders.map((r) => r.slot.caseId))) {
    const path = sources.get(caseId)
    if (!path) continue
    const name = `source-${randomUUID()}${extname(path).toLowerCase()}`
    await copyFile(path, resolve(outputDir, name), constants.COPYFILE_EXCL)
    sourceNames.set(caseId, name)
  }
  const cards: string[] = [], key = []
  const dimensionLabels = ['Hook', 'Coherence', 'Payoff', 'Speaker choice', 'Framing', 'Captions', 'Audio', 'Overall']
  const defectLabels = ['Changed meaning', 'Missing promised payoff', 'Wrong speaker', 'Essential content hidden or unreadable', 'Speech damaged or out of sync', 'Material caption error', 'Other severe defect']
  for (const [position, render] of shuffled.entries()) {
    const { slot } = render
    const label = `Video ${position + 1}`, name = `${slot.id}${extname(render.path).toLowerCase()}`
    await copyFile(render.path, resolve(outputDir, name), constants.COPYFILE_EXCL)
    key.push({ id: slot.id, label, runId: slot.runId, caseId: slot.caseId, rank: slot.rank, source: render.path })
    const sourceName = sourceNames.get(slot.caseId)
    const sourceFragment = render.start === undefined ? '' : `#t=${render.start},${render.end}`
    cards.push(`<article data-id="${slot.id}"><h2>${label}</h2><video controls preload="metadata" src="${name}"></video>
      ${sourceName ? `<details><summary>Original source — check context after watching the export</summary><p>The source player opens at the selected interval. Check the surrounding context too.</p><video controls preload="none" src="${sourceName}${sourceFragment}"></video></details>` : '<p class="notice">Original source unavailable in this package. Source fidelity has not been verified.</p>'}
      <label>Decision<select data-field="verdict"><option value="">Unrated — omit from submission</option><option value="publishable">Publishable as shown</option><option value="repairable">Keep, but needs repair</option><option value="reject">Reject this suggestion</option></select></label>
      <label>Measured repair seconds (blank if not timed)<input type="number" min="0" step="any" data-field="repairSeconds"></label>
      <label>Compared with original source<input type="checkbox" data-field="sourceCompared"${sourceName ? '' : ' disabled'}></label>
      <fieldset><legend>Severe defects — select every observed defect</legend>${severeDefects.map((d, i) => `<label>${defectLabels[i]}<input type="checkbox" data-defect="${d}"></label>`).join('')}</fieldset>
      ${reviewDimensions.map((d, i) => `<label>${dimensionLabels[i]}<select data-score="${d}"><option value="">Not assessed / not applicable</option>${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join('')}</select></label>`).join('')}
      <label>Notes / timestamps<textarea data-field="notes"></textarea></label></article>`)
  }
  await writeJson(resolve(outputDir, 'private-key.json'), key)
  await writeJson(resolve(outputDir, 'review-index.json'), index)
  await writeFile(resolve(outputDir, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blind clip review</title>
    <style>body{font:17px system-ui;max-width:950px;margin:40px auto;background:#17191d;color:#eee;padding:20px;line-height:1.5}article{padding:24px;background:#23262b;margin:24px 0;border-radius:8px}video{width:100%;max-height:580px}label{display:flex;justify-content:space-between;gap:20px;margin:14px 0}select,textarea,button,input{font:inherit;max-width:65%}textarea{width:65%;min-height:70px}button{padding:12px;cursor:pointer}fieldset{border:1px solid #686e78}summary{cursor:pointer}.notice,#status{color:#ffd58b}@media(max-width:600px){label{display:grid}select,textarea,input{max-width:100%;width:100%}input[type=checkbox]{width:auto}}</style>
    <h1>Blind clip review</h1><p>Watch each export before opening its original source. Rate independently, without consulting other reviewers. Score 1 (poor) to 5 (excellent); leave inapplicable dimensions blank. Overall is required for every reviewed clip.</p>
    <p><strong>Publishable:</strong> you would publish this exact export without correction. <strong>Repairable:</strong> a worthwhile moment you would keep after editing. <strong>Reject:</strong> you would discard the suggestion. Mark severe defects even when a clip can be repaired.</p>
    <p>Repair time means actual timed editing and verification, not an estimate. Enter 0 only for an as-is clip you checked; leave untimed work blank. Preserve the original export for rating, and time repairs on a copy. Unrated clips remain missing in the report.</p>
    <p>This evaluates editorial quality, not measured audience engagement. Download ratings before closing the page. The browser saves a draft locally when available; keep the private key and metrics hidden until scoring is frozen.</p>
    <label>Reviewer ID<input id="reviewer" autocomplete="off" required></label>${cards.join('\n') || '<p>No playable exports supplied. The coverage report records the missing outputs.</p>'}<button id="save">Download ratings</button><p id="status" role="status" aria-live="polite"></p>
    <script>
    const experimentId=${JSON.stringify(index.experimentId)};
    const draftKey='cutawan-review-'+experimentId;
    const articles=[...document.querySelectorAll('article')];
    const status=document.getElementById('status');
    function snapshot(){return {reviewer:document.getElementById('reviewer').value,forms:articles.map(a=>({id:a.dataset.id,values:[...a.querySelectorAll('input,select,textarea')].map(e=>e.type==='checkbox'?e.checked:e.value)}))};}
    function saveDraft(){try{localStorage.setItem(draftKey,JSON.stringify(snapshot()));}catch{status.textContent='Draft storage unavailable; download ratings to preserve work.';}}
    try{const draft=JSON.parse(localStorage.getItem(draftKey)||'null');if(draft){document.getElementById('reviewer').value=draft.reviewer||'';for(const a of articles){const form=draft.forms.find(f=>f.id===a.dataset.id);if(form)[...a.querySelectorAll('input,select,textarea')].forEach((e,i)=>{if(e.type==='checkbox')e.checked=!!form.values[i];else e.value=form.values[i]??'';});}}}catch{/* Downloads still work when browser storage is disabled. */}
    document.addEventListener('change',saveDraft);document.addEventListener('input',saveDraft);
    document.getElementById('save').onclick=()=>{try{
      const reviewer=document.getElementById('reviewer').value.trim();if(!reviewer)throw new Error('Enter a reviewer ID.');
      const ratings=[];
      for(const a of articles){const get=f=>a.querySelector('[data-field="'+f+'"]');const verdict=get('verdict').value;if(!verdict)continue;
        const repair=get('repairSeconds').value;const repairSeconds=repair===''?null:Number(repair);
        const defects=[...a.querySelectorAll('[data-defect]:checked')].map(e=>e.dataset.defect);
        const scores=Object.fromEntries([...a.querySelectorAll('[data-score]')].map(e=>[e.dataset.score,e.value===''?null:Number(e.value)]));
        const label=a.querySelector('h2').textContent;
        if(scores.overall===null)throw new Error(label+': rate overall quality.');
        if(repairSeconds!==null&&(!Number.isFinite(repairSeconds)||repairSeconds<0))throw new Error(label+': repair seconds must be nonnegative.');
        if(verdict==='reject'&&repairSeconds!==null)throw new Error(label+': clear repair time for a rejected clip.');
        if(verdict==='publishable'&&(defects.length||(repairSeconds!==null&&repairSeconds!==0)))throw new Error(label+': publishable as shown cannot need repair or have a severe defect.');
        ratings.push({id:a.dataset.id,verdict,repairSeconds,sourceCompared:get('sourceCompared').checked,severeDefects:defects,scores,notes:get('notes').value});
      }
      const url=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:2,experimentId,reviewer,ratings},null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='blind-ratings-'+reviewer.replace(/[^a-z0-9_-]/gi,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status.textContent='Downloaded '+ratings.length+' ratings; '+(articles.length-ratings.length)+' videos remain unrated. Keep one final file per reviewer.';
    }catch(error){status.textContent=error.message;}};
    </script></html>`, { flag: 'wx' })
}

async function summarizeReview(experimentDir: string, outputPath: string, ratingPaths: string[]): Promise<void> {
  const index = await json(resolve(experimentDir, 'review-index.json'))
  validateReviewIndex(index)
  const values = await Promise.all(ratingPaths.map((path) => json(resolve(path))))
  const summary = aggregateQualityReviews(index, values)
  await writeJson(outputPath, summary)
  console.log(`Aggregated ${summary.reviewers.length} reviewer(s): ${outputPath}`)
  if (summary.reviewers.length < index.minimumReviewers) console.warn('Insufficient independent reviewers. Coverage is reported; no clip has a complete consensus.')
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'compare' && args.length === 2) await compare(resolve(args[0]), resolve(args[1]))
  else if (command === 'export-project' && args.length === 3) await exportProject(resolve(args[0]), args[1], resolve(args[2]))
  else if (command === 'export-ranking' && args.length === 3) await exportRanking(resolve(args[0]), args[1], resolve(args[2]))
  else if (command === 'render-ranking' && (args.length === 2 || args.length === 3)) await renderRanking(resolve(args[0]), resolve(args[1]), args[2] === undefined ? 5 : Number(args[2]))
  else if (command === 'summarize-review' && args.length >= 2) await summarizeReview(resolve(args[0]), resolve(args[1]), args.slice(2))
  else throw new Error('Usage: quality-benchmark.ts compare <manifest.json> <new-output-dir> | export-project <project.json> <case-id> <new-predictions.json> | export-ranking <project.json> <case-id> <new-output-dir> | render-ranking <frozen-input-dir> <new-output-dir> [topK] | summarize-review <experiment-dir> <new-summary.json> [ratings.json ...]')
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
