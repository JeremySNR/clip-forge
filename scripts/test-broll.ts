/**
 * B-roll end-to-end test built around the user scenario: a talking-head
 * monologue about Star Wars where mentioning "Yoda" or "Darth Vader" should
 * pop a matching image over the video at that exact word.
 *
 * Uses the real OpenAI API (TTS + Whisper + suggestion LLM) and real image
 * search (Wikipedia/Openverse). Run with:
 *   npx tsx --tsconfig tsconfig.node.json scripts/test-broll.ts
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { probeVideo, extractAudioChunks, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { transcribeChunks } from '../src/main/pipeline/transcribe'
import { suggestBroll } from '../src/main/pipeline/broll'
import { searchImage, downloadImage } from '../src/main/pipeline/imagesearch'
import { renderClip } from '../src/main/pipeline/render'
import { DEFAULT_CAPTION_STYLE_ID } from '../src/shared/captionStyles'
import type { BrollItem, Clip } from '../src/shared/types'

const WORK = join(process.cwd(), '.tmp', 'broll-test')
const API_KEY = process.env.OPENAI_API_KEY ?? ''

const MONOLOGUE = `Let me tell you why the original Star Wars trilogy still holds up. First, the characters are unforgettable. Yoda is the perfect mentor, this tiny green master hiding unbelievable power in a swamp. And Darth Vader remains cinema's greatest villain, that breathing sound alone tells a whole story. Second, the world feels real. When the Millennium Falcon jumps to hyperspace for the first time, you believe every bolt of that ship. That's why these movies still matter today.`

async function synthesizeSpeech(outPath: string): Promise<void> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: MONOLOGUE, response_format: 'mp3' })
  })
  if (!res.ok) throw new Error(`TTS failed: HTTP ${res.status} ${await res.text()}`)
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()))
}

async function main(): Promise<void> {
  if (!API_KEY) {
    console.error('OPENAI_API_KEY not set; cannot run B-roll e2e test.')
    process.exit(1)
  }
  await rm(WORK, { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })

  console.log('1. Synthesizing Star Wars monologue (TTS)…')
  const speech = join(WORK, 'speech.mp3')
  await synthesizeSpeech(speech)

  console.log('2. Building talking-head style test video…')
  const source = join(WORK, 'source.mp4')
  await runFfmpeg([
    '-i', speech,
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
    '-map', '1:v', '-map', '0:a',
    '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    source
  ])
  const info = await probeVideo(source)
  console.log(`   ${info.width}x${info.height}, ${info.durationSec.toFixed(1)}s`)

  console.log('3. Transcribing…')
  const chunks = await extractAudioChunks(source, join(WORK, 'audio'), info.durationSec)
  const transcript = await transcribeChunks(API_KEY, 'whisper-1', chunks)
  const text = transcript.segments.map((s) => s.text).join(' ')
  assert.ok(/yoda/i.test(text), 'transcript should mention Yoda')

  const clip: Clip = {
    id: 'broll-clip',
    suggestedStart: 0,
    suggestedEnd: info.durationSec,
    title: 'Why the original trilogy holds up',
    hook: '',
    summary: '',
    viralityScore: 80,
    viralityReason: '',
    hashtags: [],
    thumbnailPath: null,
    focusTrack: null,
    broll: [],
    edit: {
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'manual',
      focusX: 0.5,
      captionsEnabled: true,
      captionStyleId: DEFAULT_CAPTION_STYLE_ID,
      showTitle: false,
      start: 0,
      end: info.durationSec
    }
  }

  console.log('4. Suggesting B-roll moments (LLM)…')
  const suggestions = await suggestBroll(API_KEY, 'gpt-4o-mini', transcript, clip)
  assert.ok(suggestions.length >= 1, 'expected at least one B-roll suggestion')
  const triggers = suggestions.map((s) => s.trigger.toLowerCase()).join(', ')
  console.log(`   ${suggestions.length} suggestions: ${suggestions.map((s) => `"${s.trigger}" @${s.start.toFixed(1)}s (${s.mode})`).join(', ')}`)
  assert.ok(
    /yoda|vader|falcon|star wars/.test(triggers),
    `expected a Star Wars entity among triggers, got: ${triggers}`
  )
  // Suggestions must not overlap and must sit inside the clip.
  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]
    assert.ok(s.start >= clip.edit.start && s.end <= clip.edit.end + 0.01, 'suggestion out of bounds')
    if (i > 0) assert.ok(s.start >= suggestions[i - 1].end, 'suggestions overlap')
    // The trigger word should actually be spoken near the suggested start.
    const nearby = transcript.segments
      .flatMap((seg) => seg.words)
      .filter((w) => Math.abs(w.start - s.start) < 2.5)
      .map((w) => w.text.toLowerCase().replace(/[^a-z]/g, ''))
    const triggerHead = s.trigger.toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g, '')
    assert.ok(
      nearby.some((w) => w.includes(triggerHead) || triggerHead.includes(w)),
      `trigger "${s.trigger}" not spoken near ${s.start.toFixed(1)}s (nearby: ${nearby.join(' ')})`
    )
  }
  console.log('   suggestion timing verified against word timestamps')

  console.log('5. Searching + downloading images…')
  const items: BrollItem[] = []
  for (const s of suggestions) {
    const found = await searchImage(s.query, s.trigger)
    assert.ok(found, `no image found for "${s.query}"`)
    const imagePath = await downloadImage(found.imageUrl, join(WORK, 'images'), s.id)
    assert.ok(imagePath, `download failed for ${found.imageUrl}`)
    items.push({ ...s, imagePath, sourceUrl: found.sourceUrl })
    console.log(`   "${s.trigger}" -> ${found.imageUrl.slice(0, 80)}`)
  }
  clip.broll = items

  console.log('6. Rendering with B-roll overlays + captions…')
  const out = join(WORK, 'with-broll.mp4')
  await renderClip({ clip, source: info, transcript, outputPath: out })
  const rendered = await probeVideo(out)
  assert.equal(rendered.width, 1080)
  assert.equal(rendered.height, 1920)

  // Render again with all B-roll disabled; frames during the insert window
  // must differ between the two files.
  const clean = join(WORK, 'without-broll.mp4')
  await renderClip(
    { clip: { ...clip, broll: clip.broll.map((b) => ({ ...b, enabled: false })) }, source: info, transcript, outputPath: clean }
  )
  const mid = (items[0].start + items[0].end) / 2
  for (const [name, file] of [['broll', out], ['clean', clean]] as const) {
    await runFfmpeg(['-ss', mid.toFixed(2), '-i', file, '-frames:v', '1', join(WORK, `frame-${name}.png`)])
  }
  const a = await readFile(join(WORK, 'frame-broll.png'))
  const b = await readFile(join(WORK, 'frame-clean.png'))
  assert.notDeepEqual(a, b, 'B-roll frame should differ from clean frame')
  console.log(`   overlay visible at ${mid.toFixed(1)}s; disabling items removes it`)

  console.log('\nB-roll end-to-end test passed.')
}

main().catch((err) => {
  console.error('\nB-roll test FAILED:', err)
  process.exit(1)
})
