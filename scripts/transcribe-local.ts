/**
 * Transcribe a local video with the app's installed faster-whisper
 * (Settings → local speech) into a Cutawan Transcript JSON, for offline
 * benchmarks. Uses the same stitching and word normalisation as the app.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.node.json scripts/transcribe-local.ts <video> <out.json> [--model small]
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { stitchChunkResults } from '../src/main/pipeline/transcribe'

async function main(): Promise<void> {
  const [video, out] = process.argv.slice(2)
  if (!video || !out) throw new Error('usage: transcribe-local.ts <video> <out.json> [--model small]')
  const modelIndex = process.argv.indexOf('--model')
  const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : 'small'
  const root = join(homedir(), 'Library', 'Application Support', 'cutawan', 'local-whisper')
  const temporary = await mkdtemp(join(tmpdir(), 'cutawan-transcribe-'))
  try {
    const audio = join(temporary, 'audio.wav')
    await runFfmpeg(['-i', video, '-vn', '-ac', '1', '-ar', '16000', audio])
    const started = performance.now()
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(join(root, 'venv', 'bin', 'python'), [join(process.cwd(), 'resources', 'local-whisper', 'transcribe.py')])
      let text = '', errors = ''
      child.stdout.on('data', d => { text += d })
      child.stderr.on('data', d => { errors += d })
      child.on('close', code => code === 0 ? resolve(text) : reject(new Error(errors.slice(-2000))))
      child.stdin.end(JSON.stringify({ path: audio, modelPath: join(root, 'models', model), language: 'en' }))
    })
    const res = JSON.parse(stdout)
    const transcript = stitchChunkResults([{ chunk: { path: audio, offsetSec: 0, keepFromSec: 0, keepToSec: Infinity }, res }])
    await writeFile(out, JSON.stringify(transcript))
    console.log(`${transcript.segments.length} segments in ${((performance.now() - started) / 1000).toFixed(0)}s -> ${out}`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
