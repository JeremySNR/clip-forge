/**
 * Pause-removal cut quality on saved projects.
 *
 * For every clip, computes "tighten cuts" kept segments with and without
 * voice-activity snapping and reports internal cut points that fall inside
 * detected speech (more than 50 ms from a speech edge), plus how much time is
 * still removed. Speech detection is independent acoustic evidence; word
 * timestamps alone cannot say where sound stops. Projects are read, never
 * written; detected speech is cached in --cache.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.node.json scripts/eval-cuts.ts [--cache dir] [project-id ...]
 *   npx tsx --tsconfig tsconfig.node.json scripts/eval-cuts.ts --corpus <video-dir> <transcript-dir>
 *
 * Corpus mode pairs <name>.json transcripts (scripts/transcribe-local.ts)
 * with <name>.mp4 videos and evaluates 40 s windows every 60 s.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Project, SpeechRegion, Transcript } from '../src/shared/types'
import { computeKeptSegments, type KeptSegment } from '../src/shared/tighten'
import { detectSpeech } from '../src/main/pipeline/vad'

const MARGIN = 0.05

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function projectsDir(): string {
  const base = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? process.env.APPDATA ?? '' : join(homedir(), '.config')
  return join(base, 'cutawan', 'projects')
}

function cutsInSpeech(kept: KeptSegment[] | null, speech: SpeechRegion[]): { cuts: number; inSpeech: number } {
  if (!kept) return { cuts: 0, inSpeech: 0 }
  const points = kept.flatMap((segment, i) => [...(i > 0 ? [segment.start] : []), ...(i < kept.length - 1 ? [segment.end] : [])])
  return { cuts: points.length, inSpeech: points.filter(t => speech.some(r => r.start + MARGIN < t && t < r.end - MARGIN)).length }
}

const removed = (kept: KeptSegment[] | null, start: number, end: number): number =>
  kept ? end - start - kept.reduce((sum, s) => sum + s.end - s.start, 0) : 0

async function main(): Promise<void> {
  const cache = option('cache', join(process.cwd(), '.tmp', 'vad-cache'))
  await mkdir(cache, { recursive: true })
  const corpus = process.argv.indexOf('--corpus')
  const sources: Array<{ id: string; project: Project }> = []
  if (corpus >= 0) {
    const [videos, transcripts] = process.argv.slice(corpus + 1, corpus + 3)
    for (const file of (await readdir(transcripts)).filter(f => f.endsWith('.json'))) {
      const name = file.replace(/\.json$/, '')
      const transcript = JSON.parse(await readFile(join(transcripts, file), 'utf8')) as Transcript
      const clips = Array.from({ length: Math.floor((transcript.durationSec - 40) / 60) + 1 }, (_, i) =>
        ({ edit: { start: i * 60, end: i * 60 + 40 } }))
      sources.push({ id: `corpus-${name}`, project: { name, transcript, clips, video: { path: join(videos, `${name}.mp4`) } } as unknown as Project })
    }
  }
  const ids = corpus >= 0 ? [] : process.argv.slice(2).filter(a => !a.startsWith('--') && a !== cache)
  const dir = projectsDir()
  if (corpus < 0) {
    for (const id of ids.length ? ids : await readdir(dir)) {
      const path = join(dir, id, 'project.json')
      if (existsSync(path)) sources.push({ id, project: JSON.parse(await readFile(path, 'utf8')) as Project })
    }
  }
  const totals = { clips: 0, before: { cuts: 0, inSpeech: 0, removed: 0 }, after: { cuts: 0, inSpeech: 0, removed: 0 } }
  for (const { id, project } of sources) {
    if (!project.transcript) continue
    const cached = join(cache, `${id}.json`)
    const speech: SpeechRegion[] = existsSync(cached) ? JSON.parse(await readFile(cached, 'utf8'))
      : await detectSpeech(project.video.path)
    if (!existsSync(cached)) await writeFile(cached, JSON.stringify(speech))
    const plain: Transcript = { ...project.transcript, speech: undefined }
    const aware: Transcript = { ...project.transcript, speech }
    let before = { cuts: 0, inSpeech: 0 }, after = { cuts: 0, inSpeech: 0 }, removedBefore = 0, removedAfter = 0
    for (const clip of project.clips) {
      const { start, end } = clip.edit
      const a = computeKeptSegments(plain, start, end, clip.visualStory?.protectedRanges)
      const b = computeKeptSegments(aware, start, end, clip.visualStory?.protectedRanges)
      const x = cutsInSpeech(a, speech), y = cutsInSpeech(b, speech)
      before = { cuts: before.cuts + x.cuts, inSpeech: before.inSpeech + x.inSpeech }
      after = { cuts: after.cuts + y.cuts, inSpeech: after.inSpeech + y.inSpeech }
      removedBefore += removed(a, start, end); removedAfter += removed(b, start, end)
    }
    totals.clips += project.clips.length
    for (const [key, value, gone] of [['before', before, removedBefore], ['after', after, removedAfter]] as const) {
      totals[key].cuts += value.cuts; totals[key].inSpeech += value.inSpeech; totals[key].removed += gone
    }
    console.log(`${project.name}: ${project.clips.length} clips; word-only cuts ${before.inSpeech}/${before.cuts} in speech, ` +
      `removed ${removedBefore.toFixed(1)}s; voice-aware ${after.inSpeech}/${after.cuts}, removed ${removedAfter.toFixed(1)}s`)
  }
  const pct = (a: number, b: number): string => `${(100 * a / Math.max(1, b)).toFixed(1)}%`
  console.log(`\n${totals.clips} clips. Cuts inside speech: word-only ${pct(totals.before.inSpeech, totals.before.cuts)} ` +
    `(${totals.before.inSpeech}/${totals.before.cuts}), voice-aware ${pct(totals.after.inSpeech, totals.after.cuts)}. ` +
    `Time removed: ${totals.before.removed.toFixed(1)}s -> ${totals.after.removed.toFixed(1)}s`)
  process.exit(0)
}

main().catch((error) => { console.error(error); process.exit(1) })
