/**
 * Speed and framing benchmark for active-speaker reframing.
 *
 * For each range and face-detection stride, runs `analyzeClipASD` and prints
 * stage timings. Strides after the first are compared with the first (the
 * reference): mean horizontal focus difference and the share of 0.1 s
 * samples more than 5% of the frame apart. Agreement is a regression check,
 * not a measure of speaker accuracy.
 *
 * For the reference analysis it also compares camera planners on the same
 * followed-face targets (see shared/cameraPath.ts framingMetrics): how often
 * the face sits more than a quarter crop width off-centre, the 95th
 * percentile offset, within-shot moves per minute and time spent moving.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.node.json scripts/bench-reframe.ts <video> \
 *     --ranges 60-100,300-340 [--strides 5,2,5f] [--cache dir]
 *
 * A stride suffixed with `f` detects at fixed full resolution throughout.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { analyzeClipASD, ASD_FPS } from '../src/main/pipeline/asd'
import { chooseSpeakerByScores } from '../src/main/pipeline/speaker'
import { buildFocusTrack } from '../src/main/pipeline/faces'
import { focusAt } from '../src/shared/focusTrack'
import { framingMetrics, portraitCropWidth, type FramingMetrics } from '../src/shared/cameraPath'
import { probeVideo } from '../src/main/pipeline/ffmpeg'
import { onStageTiming } from '../src/main/pipeline/timing'
import type { FocusKeyframe } from '../src/shared/types'

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

interface Run {
  seconds: number
  stages: Record<string, number>
  targets: Array<number | null>
  cuts: number[]
  switches: number
}

async function run(video: string, start: number, end: number, stride: string): Promise<Run> {
  // --cache <dir> reuses earlier analyses so planner changes re-evaluate in seconds.
  const cacheDir = option('cache', '')
  const cachePath = cacheDir && join(cacheDir, `${basename(video)}-${start}-${end}-s${stride}.json`)
  if (cachePath && existsSync(cachePath)) return JSON.parse(await readFile(cachePath, 'utf8')) as Run
  const result = await analyse(video, start, end, stride)
  if (cachePath) { await mkdir(cacheDir, { recursive: true }); await writeFile(cachePath, JSON.stringify(result)) }
  return result
}

async function analyse(video: string, start: number, end: number, stride: string): Promise<Run> {
  const stages: Record<string, number> = {}
  const stop = onStageTiming(({ stage, seconds }) => { stages[stage] = (stages[stage] ?? 0) + seconds })
  const started = performance.now()
  try {
    const analysis = await analyzeClipASD(video, start, end, undefined,
      { detectStride: parseInt(stride, 10), fixedResolution: stride.endsWith('f') })
    if (!analysis) throw new Error('ASD models unavailable')
    const { centres, switchCuts } = chooseSpeakerByScores(analysis.tracks, analysis.frameCount, analysis.sceneCuts, ASD_FPS)
    return { seconds: (performance.now() - started) / 1000, stages, targets: centres, switches: switchCuts.length,
      cuts: [...new Set([...analysis.sceneCuts, ...switchCuts])].sort((a, b) => a - b) }
  } finally { stop() }
}

function agreement(reference: FocusKeyframe[] | null, other: FocusKeyframe[] | null, start: number, end: number): string {
  if (!reference || !other) return reference === other ? 'both null' : 'one track is null'
  let total = 0, differing = 0, samples = 0
  for (let t = start; t < end; t += 0.1) {
    const d = Math.abs(focusAt(reference, t) - focusAt(other, t))
    total += d; samples++
    if (d > 0.05) differing++
  }
  return `mean |dx| ${(total / samples).toFixed(3)}, >5% apart ${(100 * differing / samples).toFixed(1)}%`
}

const format = (m: FramingMetrics): string =>
  `off-centre ${(100 * m.offCentreShare).toFixed(1)}%, p95 ${m.offCentreP95.toFixed(2)}, ` +
  `moves/min ${m.movesPerMinute.toFixed(1)}, moving ${(100 * m.movingShare).toFixed(1)}%`

async function main(): Promise<void> {
  const video = process.argv[2]
  if (!video || video.startsWith('--')) throw new Error('usage: bench-reframe.ts <video> --ranges a-b,c-d [--strides 5,2]')
  const info = await probeVideo(video)
  const cropWidth = portraitCropWidth(info.width / Math.max(1, info.height))
  const ranges = option('ranges', '0-30').split(',').map(r => r.split('-').map(Number) as [number, number])
  const strides = option('strides', '5').split(',')
  const totals = strides.map(() => 0)
  const planners = { legacy: [] as FramingMetrics[], planned: [] as FramingMetrics[] }
  const weights: number[] = []
  for (const [start, end] of ranges) {
    const runs: Run[] = []
    for (const stride of strides) runs.push(await run(video, start, end, stride))
    console.log(`\n${start}-${end}s`)
    const tracks = runs.map(r => buildFocusTrack(r.targets, start, r.cuts, ASD_FPS, { cropWidth }))
    runs.forEach((r, i) => {
      totals[i] += r.seconds
      const stages = Object.entries(r.stages).map(([k, v]) => `${k.replace('asd/', '')} ${v.toFixed(1)}`).join(', ')
      console.log(`  stride ${strides[i]}: ${r.seconds.toFixed(1)}s (${stages}), switches ${r.switches}` +
        (i ? `; vs stride ${strides[0]}: ${agreement(tracks[0], tracks[i], start, end)}` : ''))
    })
    const reference = runs[0]
    for (const planner of ['legacy', 'planned'] as const) {
      const track = buildFocusTrack(reference.targets, start, reference.cuts, ASD_FPS, { cropWidth, legacy: planner === 'legacy' })
      if (!track) { console.log(`  ${planner}: no focus track`); continue }
      const metrics = framingMetrics(reference.targets, track, start, ASD_FPS, cropWidth)
      planners[planner].push(metrics)
      if (planner === 'legacy') weights.push(end - start)
      console.log(`  ${planner.padEnd(7)} ${format(metrics)}`)
    }
  }
  const media = ranges.reduce((sum, [start, end]) => sum + end - start, 0)
  console.log(`\ntotal for ${media}s of video: ` + strides.map((s, i) => `stride ${s} ${totals[i].toFixed(1)}s`).join(', '))
  for (const planner of ['legacy', 'planned'] as const) {
    const list = planners[planner]
    if (!list.length) continue
    const w = weights.slice(0, list.length), sum = w.reduce((a, b) => a + b, 0)
    const avg = (key: keyof FramingMetrics): number => list.reduce((a, m, i) => a + m[key] * w[i], 0) / sum
    console.log(`${planner.padEnd(7)} overall: ${format({ offCentreShare: avg('offCentreShare'), offCentreP95: avg('offCentreP95'),
      movesPerMinute: avg('movesPerMinute'), movingShare: avg('movingShare') })}`)
  }
  process.exit(0)
}

main().catch((error) => { console.error(error); process.exit(1) })
