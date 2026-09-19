/** Offline model comparison and export of the current application's saved results. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, constants } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import type { Project } from '../src/shared/types'
import { evaluateQuality, validateQualitySample, type QualitySample } from '../src/shared/qualityBenchmark'

interface Manifest {
  schemaVersion: 1
  topK?: number
  iouThreshold?: number
  cases: Array<{ id: string; split: 'development' | 'test'; tags: string[]; reference: string; source?: string }>
  runs: Array<{ id: string; predictions: string }>
}
interface Predictions {
  schemaVersion: 1
  provenance: { system: string; revision: string; configuration: string }
  cases: Record<string, QualitySample>
  renders?: Array<{ caseId: string; path: string }>
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

async function compare(manifestPath: string, outputDir: string): Promise<void> {
  const manifest = await json(manifestPath) as Manifest
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported manifest version')
  uniqueIds(manifest.cases, 'Cases')
  uniqueIds(manifest.runs, 'Runs')
  const base = dirname(manifestPath)
  const references = new Map<string, QualitySample>()
  for (const entry of manifest.cases) {
    if (!['development', 'test'].includes(entry.split) || !Array.isArray(entry.tags)) throw new Error('Cases require split and tags')
    const ref = await json(resolve(base, entry.reference))
    validateQualitySample(ref)
    if (entry.source && await sha256(resolve(base, entry.source)) !== ref.sourceSha256.toLowerCase()) {
      throw new Error(`${entry.id}: source hash does not match the reference`)
    }
    references.set(entry.id, ref)
  }
  const renders: Array<{ runId: string; caseId: string; path: string }> = []
  const results = []
  for (const entry of manifest.runs) {
    const predictionPath = resolve(base, entry.predictions)
    const run = await json(predictionPath) as Predictions
    if (run.schemaVersion !== 1 || !run.cases || !run.provenance ||
      [run.provenance.system, run.provenance.revision, run.provenance.configuration].some((v) => typeof v !== 'string' || !v.trim())) {
      throw new Error(`${entry.id}: predictions require version, provenance, and cases`)
    }
    const cases = manifest.cases.map((c) => {
      if (!run.cases[c.id]) throw new Error(`${entry.id}: missing case ${c.id}; do not omit difficult cases`)
      return { id: c.id, split: c.split, tags: c.tags,
        metrics: evaluateQuality(references.get(c.id)!, run.cases[c.id], manifest.topK, manifest.iouThreshold) }
    })
    results.push({ id: entry.id, provenance: run.provenance, cases })
    for (const render of run.renders ?? []) {
      if (!references.has(render.caseId)) throw new Error(`Unknown render case: ${render.caseId}`)
      renders.push({ runId: entry.id, caseId: render.caseId, path: resolve(dirname(predictionPath), render.path) })
    }
  }
  // A new directory prevents overwriting a previous experiment or its blind key.
  await mkdir(dirname(outputDir), { recursive: true })
  await mkdir(outputDir)
  await writeJson(resolve(outputDir, 'metrics.json'), {
    schemaVersion: 1, createdAt: new Date().toISOString(),
    protocol: { topK: manifest.topK ?? 5, iouThreshold: manifest.iouThreshold ?? 0.5,
      diarization: 'zero collar, overlap included, canonical speaker IDs supplied by adapters',
      missingMetric: 'null means not evaluated; it is never a zero-error result',
      interpretation: 'No composite quality or virality score. Judge exported videos blind; report held-out cases separately.' },
    results
  })
  if (renders.length) await prepareReview(outputDir, renders)
  console.log(`Compared ${manifest.runs.length} runs on ${manifest.cases.length} cases: ${resolve(outputDir, 'metrics.json')}`)
  console.log(renders.length ? 'Blind video review: review.html (keep private-key.json hidden from reviewers).' :
    'No rendered videos supplied. Final video quality and engagement have NOT been evaluated.')
}

async function exportProject(projectPath: string, caseId: string, outputPath: string): Promise<void> {
  const project = await json(projectPath) as Project
  if (!project.video || !Array.isArray(project.clips)) throw new Error('Expected a saved Cutawan project.json')
  const sample: QualitySample = {
    sourceSha256: await sha256(project.video.path), durationSec: project.video.durationSec,
    words: project.transcript?.segments.flatMap((s) => s.words.map((w) => ({
      text: w.sourceText ?? w.text, start: w.start, end: w.end
    }))).sort((a, b) => a.start - b.start),
    highlights: project.clips.filter((c) => c.origin !== 'whole-video')
      .sort((a, b) => b.viralityScore - a.viralityScore).map((c) => ({ start: c.edit.start, end: c.edit.end }))
  }
  validateQualitySample(sample, true)
  await writeJson(outputPath, {
    schemaVersion: 1,
    provenance: { system: 'Cutawan saved project', revision: 'unrecorded in project',
      configuration: 'Saved edits and ranking; record actual model/settings/revision before a controlled comparison. No speaker IDs are inferred from crop positions.' },
    cases: { [caseId]: sample }
  } satisfies Predictions)
  console.log(`Exported ${outputPath}. Speaker identity and visual-target metrics remain unavailable until labelled outputs are supplied.`)
}

async function prepareReview(outputDir: string, renders: Array<{ runId: string; caseId: string; path: string }>): Promise<void> {
  const shuffled = renders.map((r) => ({ ...r, id: randomUUID() })).sort((a, b) => a.id.localeCompare(b.id))
  const cards = []
  const key = []
  for (const [index, render] of shuffled.entries()) {
    const extension = extname(render.path).toLowerCase()
    if (!['.mp4', '.webm', '.mov', '.m4v'].includes(extension)) throw new Error('Review renders must be local video files')
    const label = `Video ${index + 1}`, name = `${render.id}${extension}`
    await copyFile(render.path, resolve(outputDir, name), constants.COPYFILE_EXCL)
    key.push({ id: render.id, label, runId: render.runId, caseId: render.caseId, source: render.path })
    const fields = ['Hook', 'Coherence', 'Payoff', 'Speaker choice', 'Framing', 'Caption accuracy and timing', 'Audio', 'Overall']
    cards.push(`<article data-id="${render.id}"><h2>${label}</h2><video controls preload="metadata" src="${name}"></video>
      ${fields.map((f) => `<label>${f}<select data-field="${f}"><option value="">Unrated</option>${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join('')}</select></label>`).join('')}
      <label>Unusable<input type="checkbox" data-field="Unusable"></label><label>Notes<textarea data-field="Notes"></textarea></label></article>`)
  }
  await writeJson(resolve(outputDir, 'private-key.json'), key)
  await writeFile(resolve(outputDir, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Blind clip review</title>
    <style>body{font:17px system-ui;max-width:950px;margin:40px auto;background:#17191d;color:#eee;padding:20px}article{padding:24px;background:#23262b;margin:24px 0}video{width:100%;max-height:580px}label{display:flex;justify-content:space-between;gap:20px;margin:14px 0}select,textarea,button,input{font:inherit}textarea{width:65%}button{padding:12px}</style>
    <h1>Blind clip review</h1><p>Score 1 (poor) to 5 (excellent). Watch each exported video. Judge the opening, complete meaning, payoff and viewing quality. This evaluates editorial preference, not measured engagement.</p>
    <p>Download ratings before closing this page. Keep the private key and metrics hidden until scoring is complete.</p>
    <label>Reviewer ID<input id="reviewer"></label>${cards.join('\n')}<button id="save">Download ratings</button>
    <script>document.getElementById('save').onclick=()=>{const ratings=[...document.querySelectorAll('article')].map(a=>({id:a.dataset.id,ratings:Object.fromEntries([...a.querySelectorAll('[data-field]')].map(e=>[e.dataset.field,e.type==='checkbox'?e.checked:e.value]))}));const url=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:1,reviewer:document.getElementById('reviewer').value,ratings},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='blind-ratings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};</script></html>`, { flag: 'wx' })
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'compare' && args.length === 2) await compare(resolve(args[0]), resolve(args[1]))
  else if (command === 'export-project' && args.length === 3) await exportProject(resolve(args[0]), args[1], resolve(args[2]))
  else throw new Error('Usage: quality-benchmark.ts compare <manifest.json> <new-output-dir> | export-project <project.json> <case-id> <new-predictions.json>')
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
