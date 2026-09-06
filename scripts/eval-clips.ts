/**
 * Clip boundary eval over saved projects.
 *
 * The project lives or dies by where its clips start and stop. This script
 * reads every project in ClipForge's userData (transcript + clips), measures
 * each AI clip's boundaries against the transcript's sentences and prints a
 * per-project and overall report: how many clips open mid-sentence, how many
 * cut a sentence off, how the tails fall (too tight for the audio fade, clean,
 * or trailing into dead air) and the length distribution.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/eval-clips.ts [flags] [projectId…]
 *
 *   --verbose   print every clip with its opening and closing sentence
 *   --rerun     also re-run highlight detection on the saved transcript with
 *               the current prompts (needs OPENAI_API_KEY; a few cents per
 *               project, no transcription cost) and report the fresh clips
 *               next to the saved ones — the way to A/B a prompt change.
 *
 * Projects live in CLIPFORGE_USER_DATA (default ~/.config/clipforge). Runs
 * fully offline without --rerun.
 */
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeClipBoundaries,
  summarizeBoundaries,
  TAIL_MAX_SEC,
  TAIL_MIN_SEC,
  type BoundarySummary,
  type ClipBoundaryReport
} from '../src/shared/clipMetrics'
import { transcriptSentences } from '../src/shared/sentences'
import type { Clip, Project } from '../src/shared/types'

const USER_DATA = process.env.CLIPFORGE_USER_DATA ?? join(homedir(), '.config', 'clipforge')
const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const rerun = args.includes('--rerun')
const onlyIds = args.filter((a) => !a.startsWith('--'))

function pct(part: number, whole: number): string {
  return whole === 0 ? '  -' : `${Math.round((part / whole) * 100)}%`.padStart(4)
}

function printSummary(label: string, s: BoundarySummary): void {
  console.log(
    `  ${label.padEnd(9)} ${String(s.clips).padStart(3)} clips | ` +
      `mid-sentence start ${pct(s.midSentenceStarts, s.clips)} | ` +
      `mid-sentence end ${pct(s.midSentenceEnds, s.clips)} | ` +
      `tail clipped ${pct(s.clippedTails, s.clips)} | ` +
      `dead air ${pct(s.deadAirTails, s.clips)} | ` +
      `length med ${s.medianDurationSec.toFixed(0)}s (${s.minDurationSec.toFixed(0)}-${s.maxDurationSec.toFixed(0)})`
  )
}

function printClip(clip: Clip, r: ClipBoundaryReport): void {
  const flags = [
    r.startsMidSentence ? 'OPENS MID-SENTENCE' : '',
    r.endsMidSentence ? 'ENDS MID-SENTENCE' : '',
    r.tailSec !== null && r.tailSec < TAIL_MIN_SEC ? 'TAIL CLIPPED' : '',
    r.tailSec !== null && r.tailSec > TAIL_MAX_SEC ? 'DEAD AIR' : ''
  ].filter(Boolean)
  console.log(
    `    [${String(clip.viralityScore).padStart(2)}] ${r.durationSec.toFixed(1)}s  "${clip.title}"` +
      (flags.length ? `  <- ${flags.join(', ')}` : '')
  )
  console.log(`         opens:  ${r.openingSentence ?? '(no words)'}`)
  console.log(`         closes: ${r.closingSentence ?? '(no words)'}`)
}

async function main(): Promise<void> {
  const root = join(USER_DATA, 'projects')
  const ids = (await readdir(root).catch(() => [] as string[])).filter(
    (id) => onlyIds.length === 0 || onlyIds.includes(id)
  )
  if (ids.length === 0) {
    console.error(`No projects found under ${root}`)
    process.exit(1)
  }

  const allSaved: ClipBoundaryReport[] = []
  const allFresh: ClipBoundaryReport[] = []
  for (const id of ids) {
    let project: Project
    try {
      project = JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8')) as Project
    } catch {
      continue
    }
    if (!project.transcript) continue
    const sentences = transcriptSentences(project.transcript)
    const saved = project.clips.filter((c) => c.origin !== 'whole-video')
    console.log(`\n${project.name}  (${id}, ${sentences.length} sentences, video type ${project.videoType})`)
    const savedReports = saved.map((c) =>
      analyzeClipBoundaries(project.transcript!, c.edit.start, c.edit.end, sentences)
    )
    allSaved.push(...savedReports)
    printSummary('saved', summarizeBoundaries(savedReports))
    if (verbose) saved.forEach((c, i) => printClip(c, savedReports[i]))

    if (rerun) {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        console.error('  --rerun needs OPENAI_API_KEY')
        process.exit(1)
      }
      const { detectHighlights } = await import('../src/main/pipeline/highlights')
      const model = process.env.CLIPFORGE_ANALYSIS_MODEL ?? 'gpt-5.4-mini'
      const fresh = await detectHighlights(
        apiKey,
        model,
        project.transcript,
        {
          prompt: project.prompt,
          clipLength: 'auto',
          broll: false,
          hookFirst: false,
          videoType: project.videoType
        },
        project.video.durationSec
      )
      const freshReports = fresh.map((c) =>
        analyzeClipBoundaries(project.transcript!, c.edit.start, c.edit.end, sentences)
      )
      allFresh.push(...freshReports)
      printSummary('rerun', summarizeBoundaries(freshReports))
      if (verbose) fresh.forEach((c, i) => printClip(c, freshReports[i]))
    }
  }

  console.log('\nOverall')
  printSummary('saved', summarizeBoundaries(allSaved))
  if (rerun) printSummary('rerun', summarizeBoundaries(allFresh))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
