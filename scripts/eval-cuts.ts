/**
 * Pause-removal cut quality on saved projects.
 *
 * For every clip, computes "tighten cuts" kept segments with and without
 * voice-activity snapping and reports pause-cut edges that fall inside
 * detected speech (more than 50 ms from a speech edge), filler removals
 * (speech by design, counted separately), and how much time is still removed. Speech detection is independent acoustic evidence; word
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

const FILLERS = new Set(['um', 'uh', 'uhm', 'umm', 'erm', 'er', 'ah', 'mmm', 'hmm', 'mhm'])

/**
 * Pause cuts (not filler removals, which are speech by design) whose edges
 * fall inside detected sound.
 */
function cutsInSpeech(kept: KeptSegment[] | null, speech: SpeechRegion[], transcript: Transcript): { cuts: number; inSpeech: number; fillers: number } {
  if (!kept) return { cuts: 0, inSpeech: 0, fillers: 0 }
  const fillers = transcript.segments.flatMap(s => s.words).filter(w => FILLERS.has((w.sourceText ?? w.text).toLowerCase().replace(/[^a-z]/g, '')))
  let cuts = 0, inSpeech = 0, fillerGaps = 0
  for (let i = 0; i < kept.length - 1; i++) {
    const gap = { start: kept[i].end, end: kept[i + 1].start }
    if (fillers.some(f => f.start < gap.end && f.end > gap.start)) { fillerGaps++; continue }
    for (const t of [gap.start, gap.end]) {
      cuts++
      if (speech.some(r => r.start + MARGIN < t && t < r.end - MARGIN)) inSpeech++
    }
  }
  return { cuts, inSpeech, fillers: fillerGaps }
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
    let before = { cuts: 0, inSpeech: 0, fillers: 0 }, after = { cuts: 0, inSpeech: 0, fillers: 0 }, removedBefore = 0, removedAfter = 0
    for (const clip of project.clips) {
      const { start, end } = clip.edit
      const a = computeKeptSegments(plain, start, end, clip.visualStory?.protectedRanges)
      const b = computeKeptSegments(aware, start, end, clip.visualStory?.protectedRanges)
      const x = cutsInSpeech(a, speech, project.transcript), y = cutsInSpeech(b, speech, project.transcript)
      before = { cuts: before.cuts + x.cuts, inSpeech: before.inSpeech + x.inSpeech, fillers: before.fillers + x.fillers }
      after = { cuts: after.cuts + y.cuts, inSpeech: after.inSpeech + y.inSpeech, fillers: after.fillers + y.fillers }
      removedBefore += removed(a, start, end); removedAfter += removed(b, start, end)
    }
    totals.clips += project.clips.length
    for (const [key, value, gone] of [['before', before, removedBefore], ['after', after, removedAfter]] as const) {
      totals[key].cuts += value.cuts; totals[key].inSpeech += value.inSpeech; totals[key].removed += gone
    }
    console.log(`${project.name}: ${project.clips.length} clips; word-only pause-cut edges ${before.inSpeech}/${before.cuts} in speech, ` +
      `${before.fillers} filler removals, removed ${removedBefore.toFixed(1)}s; voice-aware ${after.inSpeech}/${after.cuts}, ` +
      `${after.fillers} filler removals, removed ${removedAfter.toFixed(1)}s`)
  }
  const pct = (a: number, b: number): string => `${(100 * a / Math.max(1, b)).toFixed(1)}%`
  console.log(`\n${totals.clips} clips. Cuts inside speech: word-only ${pct(totals.before.inSpeech, totals.before.cuts)} ` +
    `(${totals.before.inSpeech}/${totals.before.cuts}), voice-aware ${pct(totals.after.inSpeech, totals.after.cuts)}. ` +
    `Time removed: ${totals.before.removed.toFixed(1)}s -> ${totals.after.removed.toFixed(1)}s`)
  process.exit(0)
}

main().catch((error) => { console.error(error); process.exit(1) })
