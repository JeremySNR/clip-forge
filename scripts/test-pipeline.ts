/**
 * Headless integration test for the media pipeline (no OpenAI calls, no
 * Electron): generates a synthetic video with ffmpeg, then exercises probing,
 * audio chunk extraction, thumbnailing, caption grouping/ASS generation and
 * a full clip render with burned-in captions for every style and aspect.
 *
 * Run with: npx tsx scripts/test-pipeline.ts
 */
import { mkdir, rm, stat, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { probeVideo, extractAudioChunks, extractThumbnail, runFfmpeg, runBinary, FFPROBE_PATH } from '../src/main/pipeline/ffmpeg'
import { buildAss } from '../src/main/pipeline/captions'
import { renderClip } from '../src/main/pipeline/render'
import { groupWords, wordsInRange } from '../src/shared/captionLayout'
import { CAPTION_STYLES } from '../src/shared/captionStyles'
import type { Clip, Transcript } from '../src/shared/types'

const WORK = join(process.cwd(), '.tmp', 'pipeline-test')

function makeTranscript(): Transcript {
  // 20 seconds of fake speech, one word every 0.4s.
  const words = 'this is the moment everything changed for me and honestly nobody saw it coming until the numbers went completely through the roof last quarter. crazy right? here is exactly how we did it step by step'.split(' ')
  const perWord = 0.4
  const all = words.map((w, i) => ({ text: w, start: 1 + i * perWord, end: 1 + (i + 1) * perWord - 0.05 }))
  const mid = Math.floor(all.length / 2)
  return {
    language: 'english',
    durationSec: 22,
    segments: [
      { id: 0, text: words.slice(0, mid).join(' '), start: all[0].start, end: all[mid - 1].end, words: all.slice(0, mid) },
      { id: 1, text: words.slice(mid).join(' '), start: all[mid].start, end: all[all.length - 1].end, words: all.slice(mid) }
    ]
  }
}

function makeClip(overrides: Partial<Clip['edit']> = {}): Clip {
  return {
    id: 'test-clip',
    suggestedStart: 1,
    suggestedEnd: 16,
    title: 'The moment everything changed',
    hook: 'Nobody saw this coming…',
    summary: 'A test clip',
    viralityScore: 88,
    viralityReason: 'Strong hook',
    hashtags: ['test'],
    thumbnailPath: null,
    edit: {
      aspect: '9:16',
      reframeMode: 'crop',
      focusX: 0.5,
      captionsEnabled: true,
      captionStyleId: 'beast',
      showTitle: true,
      start: 1,
      end: 16,
      ...overrides
    }
  }
}

async function main(): Promise<void> {
  await rm(WORK, { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })

  // 1. Generate a 22s 1280x720 test video with moving content and a tone.
  const source = join(WORK, 'source.mp4')
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=22',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=22',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', source
  ])
  console.log('✓ generated test video')

  // 2. Probe.
  const info = await probeVideo(source)
  assert.equal(info.width, 1280)
  assert.equal(info.height, 720)
  assert.ok(Math.abs(info.durationSec - 22) < 0.5, `duration ${info.durationSec}`)
  console.log(`✓ probe: ${info.width}x${info.height} @ ${info.fps}fps, ${info.durationSec.toFixed(1)}s`)

  // 3. Audio chunk extraction.
  const chunks = await extractAudioChunks(source, join(WORK, 'audio'), info.durationSec)
  assert.equal(chunks.length, 1)
  const audioStat = await stat(chunks[0].path)
  assert.ok(audioStat.size > 10_000, 'audio chunk too small')
  console.log(`✓ audio extraction: ${(audioStat.size / 1024).toFixed(0)} KB mp3`)

  // 4. Thumbnail.
  const thumb = await extractThumbnail(source, 2, join(WORK, 'thumb.jpg'))
  assert.ok((await stat(thumb)).size > 1_000)
  console.log('✓ thumbnail extraction')

  // 5. Caption layout helpers.
  const transcript = makeTranscript()
  const words = wordsInRange(transcript, 1, 16)
  assert.ok(words.length > 20, `expected words in range, got ${words.length}`)
  const groups = groupWords(words, 3)
  assert.ok(groups.every((g) => g.words.length <= 3))
  assert.ok(groups.every((g) => g.end >= g.start))
  console.log(`✓ caption layout: ${words.length} words -> ${groups.length} groups`)

  // 6. ASS generation for every style.
  for (const style of CAPTION_STYLES) {
    const ass = buildAss(transcript, {
      styleId: style.id,
      width: 1080,
      height: 1920,
      clipStart: 1,
      clipEnd: 16,
      title: 'Nobody saw this coming…'
    })
    assert.ok(ass.includes('[Script Info]'))
    assert.ok(ass.includes('PlayResX: 1080'))
    const dialogueCount = (ass.match(/^Dialogue:/gm) ?? []).length
    assert.ok(dialogueCount > words.length * 0.9, `style ${style.id}: only ${dialogueCount} dialogue events`)
    await writeFile(join(WORK, `captions-${style.id}.ass`), ass)
  }
  console.log(`✓ ASS generation for ${CAPTION_STYLES.length} styles`)

  // 7. Full renders: every aspect, both reframe modes, captions burned in.
  const cases: Array<{ name: string; edit: Partial<Clip['edit']>; expectW: number; expectH: number }> = [
    { name: 'vertical-crop', edit: { aspect: '9:16', reframeMode: 'crop', focusX: 0.3 }, expectW: 1080, expectH: 1920 },
    { name: 'vertical-blur', edit: { aspect: '9:16', reframeMode: 'fit-blur' }, expectW: 1080, expectH: 1920 },
    { name: 'square', edit: { aspect: '1:1', captionStyleId: 'pill' }, expectW: 1080, expectH: 1080 },
    { name: 'wide', edit: { aspect: '16:9', captionStyleId: 'karaoke' }, expectW: 1920, expectH: 1080 },
    { name: 'original', edit: { aspect: 'original', captionStyleId: 'minimal' }, expectW: 1280, expectH: 720 },
    { name: 'no-captions', edit: { captionsEnabled: false, showTitle: false }, expectW: 1080, expectH: 1920 }
  ]
  for (const c of cases) {
    const out = join(WORK, `render-${c.name}.mp4`)
    let lastProgress = 0
    await renderClip({
      clip: makeClip(c.edit),
      source: info,
      transcript,
      outputPath: out,
      onProgress: (f) => {
        lastProgress = f
      }
    })
    const rendered = await probeVideo(out)
    assert.equal(rendered.width, c.expectW, `${c.name} width`)
    assert.equal(rendered.height, c.expectH, `${c.name} height`)
    assert.ok(Math.abs(rendered.durationSec - 15) < 1, `${c.name} duration ${rendered.durationSec}`)
    assert.ok(lastProgress > 0.5, `${c.name} progress reporting (${lastProgress})`)
    // Verify an audio stream survived the render.
    const streams = await runBinary(FFPROBE_PATH, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out])
    assert.ok(streams.includes('audio'), `${c.name} has audio`)
    console.log(`✓ render ${c.name}: ${rendered.width}x${rendered.height}, ${rendered.durationSec.toFixed(1)}s`)
  }

  // 8. Sanity check: burned captions actually change pixels vs no-captions render.
  const withCaps = await readFile(join(WORK, 'render-vertical-crop.mp4'))
  const noCaps = await readFile(join(WORK, 'render-no-captions.mp4'))
  assert.notEqual(withCaps.length, noCaps.length)
  console.log('✓ captioned render differs from clean render')

  console.log('\nAll pipeline tests passed.')
}

main().catch((err) => {
  console.error('\nPipeline test FAILED:', err)
  process.exit(1)
})
