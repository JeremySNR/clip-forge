/**
 * End-to-end test using a real YouTube video: exercises the yt-dlp import
 * path, face detection / auto-reframing on real footage, and (when
 * OPENAI_API_KEY is set) the full transcription -> highlights -> render flow.
 *
 * Run with: npx tsx --tsconfig tsconfig.node.json scripts/test-youtube.ts [url]
 */
import { mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { ensureYtDlp, fetchUrlMeta, downloadUrlVideo } from '../src/main/pipeline/ytdlp'
import { probeVideo, extractAudioChunks } from '../src/main/pipeline/ffmpeg'
import { analyzeClipFocus } from '../src/main/pipeline/faces'
import { focusAt } from '../src/shared/focusTrack'
import { transcribeChunks } from '../src/main/pipeline/transcribe'
import { detectHighlights } from '../src/main/pipeline/highlights'
import { renderClip } from '../src/main/pipeline/render'
import type { Clip } from '../src/shared/types'

// "Me at the zoo" — the first YouTube video: 19s, one speaker on the left
// half of a 4:3 frame. Good test for both speech and face tracking. YouTube
// aggressively bot-checks datacenter IPs, so we fall back to the official
// archive.org mirror (same yt-dlp code path) when that happens.
const CANDIDATE_URLS = [
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  'https://archive.org/details/youtube-jNQXAC9IVRw'
]

async function main(): Promise<void> {
  const urls = process.argv[2] ? [process.argv[2]] : CANDIDATE_URLS
  const apiKey = process.env.OPENAI_API_KEY ?? ''
  // Cache downloads per URL so repeated runs skip the download step.
  const WORK = join(
    process.cwd(),
    '.tmp',
    `youtube-test-${createHash('sha1').update(urls[0]).digest('hex').slice(0, 8)}`
  )
  await rm(join(WORK, 'audio'), { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })

  console.log('1. Ensuring yt-dlp binary…')
  let lastSetupPct = -1
  const binPath = await ensureYtDlp((p) => {
    const pct = Math.round(p.progress * 100)
    if (p.progress >= 0 && pct !== lastSetupPct) {
      lastSetupPct = pct
      process.stdout.write(`\r   ${pct}% ${p.message}   `)
    }
  })
  console.log(`\n   binary: ${binPath}`)

  console.log('2. Fetching metadata…')
  let meta: Awaited<ReturnType<typeof fetchUrlMeta>> | null = null
  for (const url of urls) {
    try {
      meta = await fetchUrlMeta(binPath, url)
      break
    } catch (err) {
      console.log(`   ${url} unavailable (${err instanceof Error ? err.message.split('\n')[0].slice(0, 80) : err}), trying next…`)
    }
  }
  if (!meta) throw new Error('No candidate URL could be resolved')
  console.log(`   "${meta.title}" (${meta.durationSec}s) from ${meta.webpageUrl}`)
  assert.ok(meta.durationSec > 3)

  console.log('3. Downloading video…')
  const videoPath = join(WORK, 'source.mp4')
  if (existsSync(videoPath)) {
    console.log('   (cached from previous run)')
  } else {
    let lastPct = -1
    await downloadUrlVideo(binPath, meta.webpageUrl, videoPath, (p) => {
      const pct = Math.round(p.progress * 100)
      if (pct !== lastPct) {
        lastPct = pct
        process.stdout.write(`\r   ${pct}% ${p.message}   `)
      }
    })
    process.stdout.write('\n')
  }
  const info = await probeVideo(videoPath)
  console.log(`\n   downloaded: ${info.width}x${info.height}, ${info.durationSec.toFixed(1)}s, ${(info.sizeBytes / 1024 / 1024).toFixed(1)} MB`)
  assert.ok(Math.abs(info.durationSec - meta.durationSec) < 3, 'duration mismatch vs metadata')

  console.log('4. Face detection / auto-reframe track…')
  // Sample a window starting 25% in: long shows often open with title cards.
  const fwStart = info.durationSec * 0.25
  const track = await analyzeClipFocus(videoPath, fwStart, Math.min(fwStart + 30, info.durationSec))
  assert.ok(track && track.length >= 1, 'expected a focus track on footage with a face')
  console.log(`   ${track.length} segment(s):`, track.map((k) => `t=${k.t.toFixed(1)} x=${k.x.toFixed(2)}`).join(', '))
  const sampled = focusAt(track, 2)
  assert.ok(sampled >= 0 && sampled <= 1)

  if (!apiKey) {
    console.log('\nOPENAI_API_KEY not set — skipping transcription/highlight stages.')
    console.log('YouTube import + face tracking tests passed.')
    return
  }

  console.log('5. Transcribing…')
  const chunks = await extractAudioChunks(videoPath, join(WORK, 'audio'), info.durationSec)
  const transcript = await transcribeChunks(apiKey, 'whisper-1', chunks)
  const words = transcript.segments.reduce((n, s) => n + s.words.length, 0)
  assert.ok(words > 10, `too few words transcribed: ${words}`)
  // Catches chunk-offset stitching bugs: timestamps must span the whole video.
  const lastEnd = Math.max(...transcript.segments.map((s) => s.end))
  assert.ok(lastEnd > info.durationSec * 0.75, `transcript ends early: ${lastEnd.toFixed(0)}s of ${info.durationSec.toFixed(0)}s`)
  console.log(`   ${transcript.segments.length} segments, ${words} words, last timestamp ${lastEnd.toFixed(1)}s`)
  console.log(`   "${transcript.segments.map((s) => s.text).join(' ').slice(0, 120)}…"`)

  console.log('6. Detecting highlights…')
  const clips = await detectHighlights(apiKey, 'gpt-4o-mini', transcript, { prompt: '', clipLength: 'short' }, info.durationSec)
  assert.ok(clips.length >= 1, 'no clips found')
  for (const c of clips) {
    const dur = c.suggestedEnd - c.suggestedStart
    console.log(`   - [${c.viralityScore}] "${c.title}" (${c.suggestedStart.toFixed(1)}-${c.suggestedEnd.toFixed(1)}s, ${dur.toFixed(1)}s)`)
    assert.ok(dur >= Math.min(12, info.durationSec * 0.5), `clip too short: ${dur.toFixed(1)}s`)
  }
  if (info.durationSec > 300) {
    const lastStart = Math.max(...clips.map((c) => c.suggestedStart))
    assert.ok(lastStart > info.durationSec * 0.15, 'clips all clustered at the start of a long video')
  }

  console.log('7. Rendering top clip with auto framing + captions…')
  const top: Clip = clips[0]
  top.focusTrack = await analyzeClipFocus(videoPath, top.edit.start, top.edit.end)
  if (top.focusTrack) top.edit.framing = 'auto'
  top.edit.showTitle = true
  const out = join(WORK, 'top-clip.mp4')
  await renderClip({ clip: top, source: info, transcript, outputPath: out })
  const rendered = await probeVideo(out)
  assert.equal(rendered.width, 1080)
  assert.equal(rendered.height, 1920)
  console.log(`   rendered ${rendered.width}x${rendered.height}, ${rendered.durationSec.toFixed(1)}s (framing: ${top.edit.framing}) -> ${out}`)

  console.log('\nYouTube end-to-end test passed.')
}

main().catch((err) => {
  console.error('\nYouTube test FAILED:', err)
  process.exit(1)
})
