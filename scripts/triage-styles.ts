/**
 * Run the local shot-style triage (shared/shotStyle.ts) across a video in
 * fixed windows and print one line per window, for labelling and comparison
 * against the layouts the app actually chose.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.node.json scripts/triage-styles.ts <video> [--window 30] [--json out.json]
 *
 * In the app, CUTAWAN_LAYOUT_TRIAGE=1 logs the same triage beside each clip's
 * real layout decision as a `[layout-triage]` line.
 */
import { writeFile } from 'node:fs/promises'
import { probeVideo } from '../src/main/pipeline/ffmpeg'
import { triageClipStyle, type ClipTriage } from '../src/main/pipeline/shotTriage'

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

async function main(): Promise<void> {
  const video = process.argv[2]
  if (!video) throw new Error('Usage: triage-styles.ts <video> [--window 30] [--json out.json]')
  const window = Number(option('window', '30'))
  const { durationSec } = await probeVideo(video)
  const rows: Array<{ start: number; end: number } & Omit<ClipTriage, 'samples'> & { samples: string[] }> = []
  for (let start = 0; start < durationSec; start += window) {
    const end = Math.min(durationSec, start + window)
    const t = await triageClipStyle(video, start, end)
    const row = { start, end, style: t.style, recommendation: t.recommendation, confidence: t.confidence,
      smallFaces: t.smallFaces, inset: t.inset, seconds: t.seconds, samples: t.samples.map(s => s.style) }
    rows.push(row)
    console.log(`${start.toFixed(0).padStart(6)}–${end.toFixed(0).padEnd(6)} ${String(t.style).padEnd(22)} ` +
      `${t.recommendation.padEnd(26)} conf ${t.confidence.toFixed(2)}  ${t.seconds.toFixed(1)}s  [${row.samples.join(' ')}]`)
  }
  const json = option('json', '')
  if (json) await writeFile(json, JSON.stringify(rows, null, 2))
}

main().then(() => process.exit(0), (error: unknown) => { console.error(error); process.exit(1) })
