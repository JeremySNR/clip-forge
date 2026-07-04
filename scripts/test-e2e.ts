/**
 * Full end-to-end test of the AI pipeline against the real OpenAI API
 * (requires OPENAI_API_KEY). Synthesizes a spoken monologue with OpenAI TTS,
 * builds a video from it, then runs the exact production code path:
 * audio chunking -> Whisper transcription -> LLM highlight detection ->
 * captioned clip render.
 *
 * Run with: npx tsx --tsconfig tsconfig.node.json scripts/test-e2e.ts
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { probeVideo, extractAudioChunks, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { transcribeChunks } from '../src/main/pipeline/transcribe'
import { detectHighlights } from '../src/main/pipeline/highlights'
import { renderClip } from '../src/main/pipeline/render'

const WORK = join(process.cwd(), '.tmp', 'e2e-test')
const API_KEY = process.env.OPENAI_API_KEY ?? ''

const MONOLOGUE = `Let me tell you something nobody in this industry wants to admit. Most startups don't fail because of competition. They fail because the founders build something nobody asked for. I spent two years and four hundred thousand dollars learning that lesson the hard way.

Here's what happened. We built a beautiful product. Perfect code, gorgeous design, eighteen months of work. We launched, and we got twelve signups. Twelve. My co-founder cried in the parking lot.

But here's the crazy part. The thing that saved us took one weekend to build. We threw together an ugly landing page for a completely different idea, a tool that automatically writes invoices from emails. We shared it in three communities. By Monday we had nine hundred people on the waitlist.

So here's my advice to every founder listening. Sell it before you build it. If you can't get strangers excited about a landing page, you will never get them excited about a product. That one rule would have saved me two years of my life.`

async function synthesizeSpeech(outPath: string): Promise<void> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: MONOLOGUE, response_format: 'mp3' })
  })
  if (!res.ok) throw new Error(`TTS failed: HTTP ${res.status} ${await res.text()}`)
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()))
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('OPENAI_API_KEY not set; skipping e2e test.')
    process.exit(1)
  }
  await rm(WORK, { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })

  console.log('1. Synthesizing speech with OpenAI TTS…')
  const speech = join(WORK, 'speech.mp3')
  await synthesizeSpeech(speech)

  console.log('2. Building test video around the speech…')
  const source = join(WORK, 'source.mp4')
  await runFfmpeg([
    '-i', speech,
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-map', '1:v', '-map', '0:a',
    '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', source
  ])
  const info = await probeVideo(source)
  console.log(`   video: ${info.width}x${info.height}, ${info.durationSec.toFixed(1)}s`)

  console.log('3. Extracting audio chunks…')
  const chunks = await extractAudioChunks(source, join(WORK, 'audio'), info.durationSec)

  console.log('4. Transcribing with Whisper…')
  const transcript = await transcribeChunks(API_KEY, 'whisper-1', chunks)
  assert.ok(transcript.segments.length > 0, 'no transcript segments')
  const wordCount = transcript.segments.reduce((n, s) => n + s.words.length, 0)
  assert.ok(wordCount > 100, `too few words: ${wordCount}`)
  const text = transcript.segments.map((s) => s.text).join(' ').toLowerCase()
  assert.ok(text.includes('landing page'), 'transcript missing expected phrase')
  console.log(`   ${transcript.segments.length} segments, ${wordCount} words, language=${transcript.language}`)

  console.log('5. Detecting highlights with LLM…')
  const clips = await detectHighlights(
    API_KEY,
    'gpt-4o-mini',
    transcript,
    { prompt: '', clipLength: 'short' },
    info.durationSec
  )
  assert.ok(clips.length >= 1, 'no clips detected')
  for (const c of clips) {
    assert.ok(c.suggestedStart >= 0 && c.suggestedEnd <= info.durationSec + 0.5, `clip out of bounds: ${c.suggestedStart}-${c.suggestedEnd}`)
    assert.ok(c.suggestedEnd - c.suggestedStart >= 3, 'clip too short')
    assert.ok(c.viralityScore >= 0 && c.viralityScore <= 99)
    assert.ok(c.title.length > 0)
  }
  console.log(`   ${clips.length} clips:`)
  for (const c of clips) {
    console.log(`   - [${c.viralityScore}] "${c.title}" (${c.suggestedStart.toFixed(1)}s-${c.suggestedEnd.toFixed(1)}s)`)
    console.log(`       hook: ${c.hook}`)
    console.log(`       why: ${c.viralityReason}`)
  }

  console.log('6. Rendering top clip with captions…')
  const top = clips[0]
  top.edit.showTitle = true
  const out = join(WORK, 'top-clip.mp4')
  await renderClip({ clip: top, source: info, transcript, outputPath: out })
  const rendered = await probeVideo(out)
  assert.equal(rendered.width, 1080)
  assert.equal(rendered.height, 1920)
  console.log(`   rendered ${rendered.width}x${rendered.height}, ${rendered.durationSec.toFixed(1)}s -> ${out}`)

  console.log('\nEnd-to-end test passed.')
}

main().catch((err) => {
  console.error('\nE2E test FAILED:', err)
  process.exit(1)
})
