/**
 * End-to-end local reframing check: analyse a source range with the same
 * layout route the app uses (no AI connection; talking-head analysis), export
 * it through the real renderer, and write a contact sheet of the output.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.node.json scripts/render-reframe.ts <video> <start> <end> <out-dir> \
 *     [--transcript t.json] [--no-split] [--analyse-only] [--encoder cpu|gpu]
 */
import { mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { analyzeClipLayout } from '../src/main/pipeline/clipLayout'
import { renderClip } from '../src/main/pipeline/render'
import { probeVideo, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { DEFAULT_CAPTION_STYLE_ID } from '../src/shared/captionStyles'
import type { Clip, Transcript } from '../src/shared/types'

async function main(): Promise<void> {
  const [video, from, to, out] = process.argv.slice(2)
  if (!out) throw new Error('usage: render-reframe.ts <video> <start> <end> <out-dir> [--transcript t.json] [--no-split]')
  const start = Number(from), end = Number(to)
  const transcriptIndex = process.argv.indexOf('--transcript')
  const transcript: Transcript | null = transcriptIndex >= 0
    ? JSON.parse(readFileSync(process.argv[transcriptIndex + 1], 'utf8')) : null
  await mkdir(out, { recursive: true })
  const source = await probeVideo(video)
  const clip: Clip = {
    id: 'reframe-check', suggestedStart: start, suggestedEnd: end, title: 'Reframe check', hook: '', summary: '',
    viralityScore: 50, visualSummary: null, viralityReason: '', hashtags: [], thumbnailPath: null, focusTrack: null, broll: [],
    reframeStatus: 'pending',
    edit: { aspect: '9:16', reframeMode: 'crop', framing: 'auto', tightenCuts: Boolean(transcript), focusX: 0.5,
      captionsEnabled: Boolean(transcript), captionStyleId: DEFAULT_CAPTION_STYLE_ID, showTitle: false, start, end,
      speakerSplit: !process.argv.includes('--no-split') }
  }
  let started = performance.now()
  await analyzeClipLayout(video, clip, 'talking-head', '', '', transcript ?? undefined)
  const analysed = (performance.now() - started) / 1000
  const shots = clip.visualLayout?.shots ?? []
  console.log(`analysed in ${analysed.toFixed(1)}s; ${clip.focusTrack?.length ?? 0} focus keyframes; ` +
    `${shots.filter(s => s.composition).length} split ranges: ` +
    shots.filter(s => s.composition).map(s => `${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(', '))
  for (const shot of shots.filter(s => s.composition)) {
    console.log(`  ${shot.start.toFixed(1)}: ` + shot.composition!.layers.map(l =>
      `[x ${l.source.x.toFixed(3)} y ${l.source.y.toFixed(3)} w ${l.source.width.toFixed(3)} h ${l.source.height.toFixed(3)}]`).join(' '))
  }
  if (process.argv.includes('--analyse-only')) process.exit(0)
  let output = join(out, `${basename(video).replace(/\.[^.]+$/, '')}-${start}-${end}.mp4`)
  started = performance.now()
  const encoderIndex = process.argv.indexOf('--encoder')
  const encoder = encoderIndex >= 0 ? process.argv[encoderIndex + 1] as 'auto' | 'cpu' | 'gpu' : 'cpu'
  const suffix = encoderIndex >= 0 ? `-${encoder}` : ''
  if (suffix) output = output.replace(/\.mp4$/, `${suffix}.mp4`)
  await renderClip({ clip, source, transcript, outputPath: output, encoder })
  console.log(`rendered in ${((performance.now() - started) / 1000).toFixed(1)}s -> ${output}`)
  const sheet = output.replace(/\.mp4$/, '-sheet.jpg')
  const step = Math.max(1, (end - start) / 12)
  await runFfmpeg(['-y', '-i', output, '-vf', `fps=1/${step.toFixed(2)},scale=216:-2,tile=6x2`, '-frames:v', '1', sheet])
  console.log(`sheet -> ${sheet}`)
  process.exit(0)
}

main().catch((error) => { console.error(error); process.exit(1) })
