/**
 * Encoder tests: arg building, NVENC detection honesty (an ffmpeg with NVENC
 * compiled in but no GPU must NOT count as available), resolution fallback,
 * quality-tier renders, and the real GPU-ffmpeg download/extract path.
 *
 * Run with: npx tsx --tsconfig tsconfig.node.json scripts/test-encoders.ts
 */
import { existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  encoderArgs,
  audioArgs,
  getGpuStatus,
  resolveEncoder,
  downloadGpuFfmpeg
} from '../src/main/pipeline/encoders'
import { probeVideo, runFfmpeg, runBinary, FFMPEG_PATH } from '../src/main/pipeline/ffmpeg'
import { renderClip } from '../src/main/pipeline/render'
import { DEFAULT_CAPTION_STYLE_ID } from '../src/shared/captionStyles'
import type { Clip } from '../src/shared/types'

const WORK = join(process.cwd(), '.tmp', 'encoder-test')

function makeClip(): Clip {
  return {
    id: 'enc-test',
    suggestedStart: 0.5,
    suggestedEnd: 6,
    title: 'Encoder test',
    hook: '',
    summary: '',
    viralityScore: 50,
    viralityReason: '',
    hashtags: [],
    thumbnailPath: null,
    focusTrack: null,
    edit: {
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'manual',
      focusX: 0.5,
      captionsEnabled: false,
      captionStyleId: DEFAULT_CAPTION_STYLE_ID,
      showTitle: false,
      start: 0.5,
      end: 6
    }
  }
}

function testArgBuilding(): void {
  const cpuHigh = encoderArgs('cpu', 'high')
  assert.ok(cpuHigh.includes('libx264') && cpuHigh.includes('slow') && cpuHigh.includes('17'))
  const cpuDraft = encoderArgs('cpu', 'draft')
  assert.ok(cpuDraft.includes('veryfast') && cpuDraft.includes('23'))
  const nv = encoderArgs('nvenc', 'high')
  assert.ok(nv.includes('h264_nvenc') && nv.includes('p7') && nv.includes('vbr'))
  assert.ok(encoderArgs('nvenc', 'standard').includes('p5'))
  assert.ok(audioArgs('high').includes('192k'))
  assert.ok(audioArgs('standard').includes('160k'))
  console.log('✓ encoder/audio arg building for all tiers')
}

async function testDetectionHonesty(): Promise<void> {
  // This CI box has a system ffmpeg with NVENC compiled in but no GPU: the
  // verification encode must fail and the status must say "not available".
  let systemHasNvencCompiled = false
  try {
    const out = await runBinary('ffmpeg', ['-hide_banner', '-encoders'])
    systemHasNvencCompiled = out.includes('h264_nvenc')
  } catch {
    /* no system ffmpeg at all */
  }

  const status = await getGpuStatus()
  console.log(`   status: available=${status.available} — "${status.detail}"`)
  assert.equal(status.available, false, 'no GPU present, must not report available')
  if (systemHasNvencCompiled) {
    assert.match(status.detail, /no working NVIDIA GPU/)
    console.log('✓ NVENC-compiled ffmpeg without a GPU is correctly rejected by test encode')
  } else {
    console.log('✓ GPU correctly reported unavailable')
  }

  const auto = await resolveEncoder('auto')
  assert.equal(auto.kind, 'cpu')
  const cpu = await resolveEncoder('cpu')
  assert.equal(cpu.kind, 'cpu')
  assert.equal(cpu.bin, FFMPEG_PATH)
  await assert.rejects(resolveEncoder('gpu'), /GPU encoding is not available/)
  console.log('✓ resolution: auto falls back to CPU, forced GPU fails clearly')
}

async function testQualityRenders(): Promise<void> {
  await rm(WORK, { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })
  const source = join(WORK, 'source.mp4')
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=7',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=7',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source
  ])
  const info = await probeVideo(source)

  const sizes: Record<string, number> = {}
  for (const quality of ['draft', 'standard', 'high'] as const) {
    const out = join(WORK, `render-${quality}.mp4`)
    await renderClip({
      clip: makeClip(),
      source: info,
      transcript: null,
      outputPath: out,
      encoder: 'auto',
      quality
    })
    const rendered = await probeVideo(out)
    assert.equal(rendered.width, 1080)
    assert.equal(rendered.height, 1920)
    sizes[quality] = (await stat(out)).size
    console.log(`✓ ${quality} render: ${(sizes[quality] / 1024).toFixed(0)} KB`)
  }
  // Higher quality tiers must not produce smaller files on identical input.
  assert.ok(sizes.high >= sizes.draft, 'high quality should not be smaller than draft')
}

async function testGpuFfmpegDownload(): Promise<void> {
  if (process.env.SKIP_GPU_DOWNLOAD) {
    console.log('- skipping GPU ffmpeg download (SKIP_GPU_DOWNLOAD set)')
    return
  }
  const status = await downloadGpuFfmpeg((p) => {
    if (p.progress >= 0 && Math.round(p.progress * 100) % 25 === 0) {
      process.stdout.write(`\r   ${Math.round(p.progress * 100)}% ${p.message}      `)
    }
  })
  process.stdout.write('\n')
  const binPath = join(process.cwd(), '.tmp', 'userData', 'bin', 'ffmpeg-gpu')
  assert.ok(existsSync(binPath), 'downloaded binary missing')
  const encoders = await runBinary(binPath, ['-hide_banner', '-encoders'])
  assert.ok(encoders.includes('h264_nvenc'), 'downloaded build lacks NVENC')
  // Still no GPU on this machine, so availability must remain false.
  assert.equal(status.available, false)
  console.log('✓ GPU ffmpeg download + extract works; NVENC compiled in; honest about missing GPU')
}

async function main(): Promise<void> {
  testArgBuilding()
  await testDetectionHonesty()
  await testQualityRenders()
  await testGpuFfmpegDownload()
  console.log('\nAll encoder tests passed.')
}

main().catch((err) => {
  console.error('\nEncoder test FAILED:', err)
  process.exit(1)
})
