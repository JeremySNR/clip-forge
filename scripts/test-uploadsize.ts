/**
 * Offline end-to-end check for size-targeted rendering (the export-under-a
 * path). Renders a synthetic clip against a hard byte cap and asserts the
 * finished file actually fits, at the frame size the planner chose, in a
 * single generation.
 *
 * Makes no API calls. Run with:
 *   npx tsx --tsconfig tsconfig.node.json scripts/test-uploadsize.ts
 */
import { stat, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { probeVideo, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { renderClip } from '../src/main/pipeline/render'
import { planUploadEncode } from '../src/shared/uploadBudget'
import { DEFAULT_CAPTION_STYLE_ID } from '../src/shared/captionStyles'
import type { Clip, Transcript, VideoInfo } from '../src/shared/types'

const WORK = join(process.cwd(), '.tmp', 'uploadsize-test')
const MB = 1024 * 1024
const CLIP_SEC = 20

function transcript(): Transcript {
  const words = Array.from({ length: CLIP_SEC * 2 }, (_, i) => ({
    text: `word${i}`,
    start: i * 0.5,
    end: i * 0.5 + 0.4
  }))
  return {
    language: 'en',
    durationSec: CLIP_SEC,
    segments: [{ id: 0, start: 0, end: CLIP_SEC, text: words.map((w) => w.text).join(' '), words }]
  }
}

function makeClip(): Clip {
  return {
    id: 'size-test',
    title: 'Size test',
    summary: '',
    hook: 'Hook line',
    caption: null,
    viralityScore: 50,
    viralityReason: '',
    visualSummary: null,
    hashtags: [],
    thumbnailPath: null,
    focusTrack: null,
    contentType: 'speaker',
    suggestedStart: 0,
    suggestedEnd: CLIP_SEC,
    broll: [],
    edit: {
      start: 0,
      end: CLIP_SEC,
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'manual',
      focusX: 0.5,
      captionsEnabled: true,
      captionStyleId: DEFAULT_CAPTION_STYLE_ID,
      captionFontFamily: null,
      showTitle: true,
      tightenCuts: false,
      autoZoom: false
    }
  }
}

async function makeSource(): Promise<VideoInfo> {
  const source = join(WORK, 'source.mp4')
  // testsrc2 is deliberately hard to compress, so a lazy encoder overshoots.
  await runFfmpeg([
    '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30:duration=${CLIP_SEC}`,
    '-f', 'lavfi', '-i', `sine=frequency=330:duration=${CLIP_SEC}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', source
  ])
  return probeVideo(source)
}

async function testFitsCap(info: VideoInfo, capMb: number): Promise<void> {
  const capBytes = capMb * MB
  const out = join(WORK, `fit-${capMb}mb.mp4`)
  const plan = planUploadEncode({
    capBytes,
    durationSec: CLIP_SEC,
    width: 1080,
    height: 1920,
    sourceFps: info.fps,
    hasAudio: info.hasAudio
  })

  await renderClip({
    clip: makeClip(),
    source: info,
    transcript: transcript(),
    outputPath: out,
    sizeTargetBytes: capBytes
  })

  const { size } = await stat(out)
  const rendered = await probeVideo(out)

  assert.ok(
    size <= capBytes,
    `${capMb}MB cap: output is ${(size / MB).toFixed(2)}MB, over the cap`
  )
  // Two-pass should land close to the target, not miles under it — undershoot
  // is wasted quality just as overshoot is a rejected upload.
  assert.ok(
    size > capBytes * 0.7,
    `${capMb}MB cap: output is only ${(size / MB).toFixed(2)}MB, wasting budget`
  )
  assert.equal(rendered.width, plan.width, `${capMb}MB cap: width should match the plan`)
  assert.equal(rendered.height, plan.height, `${capMb}MB cap: height should match the plan`)
  assert.ok(rendered.hasAudio, `${capMb}MB cap: audio must survive`)
  assert.ok(
    Math.abs(rendered.durationSec - CLIP_SEC) < 0.5,
    `${capMb}MB cap: duration should be intact, got ${rendered.durationSec.toFixed(2)}s`
  )

  console.log(
    `✓ ${String(capMb).padStart(2)}MB cap -> ${(size / MB).toFixed(2)}MB ` +
      `(${Math.round((size / capBytes) * 100)}% of budget), ` +
      `${rendered.width}x${rendered.height} @ ${plan.videoKbps}kbps` +
      `${plan.downscaled ? ' (downscaled)' : ''}`
  )
}

async function testLeavesNoTempFiles(info: VideoInfo): Promise<void> {
  const { readdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = join(tmpdir(), 'clipforge')
  const before = new Set(await readdir(dir).catch(() => [] as string[]))
  await renderClip({
    clip: makeClip(),
    source: info,
    transcript: transcript(),
    outputPath: join(WORK, 'temps.mp4'),
    sizeTargetBytes: 8 * MB
  })
  const after = await readdir(dir).catch(() => [] as string[])
  const leaked = after.filter((f) => !before.has(f) && /^(x264|captions|filter|focus)-/.test(f))
  assert.deepEqual(leaked, [], `two-pass render leaked temp files: ${leaked.join(', ')}`)
  console.log('✓ no caption / filter / two-pass stats files left behind')
}

async function main(): Promise<void> {
  await rm(WORK, { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })
  const info = await makeSource()
  console.log(`source: ${info.width}x${info.height} @ ${info.fps}fps, ${CLIP_SEC}s\n`)

  // Generous cap: should stay at full 1080x1920.
  await testFitsCap(info, 18)
  // Tight cap: should downscale rather than starve the frame.
  await testFitsCap(info, 4)
  await testLeavesNoTempFiles(info)

  console.log('\nAll upload-size tests passed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
