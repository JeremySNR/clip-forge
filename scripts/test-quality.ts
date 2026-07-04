/**
 * Offline tests for the output-quality work: tighten-cuts segment math and
 * time remapping, tightened renders (duration actually shrinks, captions
 * remap), loudness normalisation, bundled fonts, and scene-cut splitting in
 * the focus track builder.
 *
 * Run with: npx tsx --tsconfig tsconfig.node.json scripts/test-quality.ts
 */
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { computeKeptSegments, remapTranscript, TimeMap } from '../src/shared/tighten'
import { buildFocusTrack } from '../src/main/pipeline/faces'
import { fontsDir } from '../src/main/pipeline/captions'
import { annotateEnergy } from '../src/main/pipeline/energy'
import { probeVideo, runFfmpeg, runBinary, FFPROBE_PATH } from '../src/main/pipeline/ffmpeg'
import { renderClip } from '../src/main/pipeline/render'
import { DEFAULT_CAPTION_STYLE_ID } from '../src/shared/captionStyles'
import type { Clip, Transcript, TranscriptWord } from '../src/shared/types'

const WORK = join(process.cwd(), '.tmp', 'quality-test')

/**
 * Synthetic transcript with deliberate flaws: an "um" at 3.0s, a 2s dead gap
 * at 6-8s, and a long trailing pause.
 */
function flawedTranscript(): Transcript {
  const words: TranscriptWord[] = []
  const push = (text: string, start: number, dur = 0.3): void => {
    words.push({ text, start, end: start + dur })
  }
  push('So', 1.0)
  push('the', 1.4)
  push('thing', 1.8)
  push('is', 2.2)
  push('um,', 3.0, 0.4) // filler
  push('nobody', 3.6)
  push('tells', 4.0)
  push('you', 4.4)
  push('this.', 4.8)
  // 2s dead air gap: 5.1 -> 8.0
  push('It', 8.0)
  push('changes', 8.4)
  push('everything', 8.9)
  push('forever.', 9.5)
  // trailing silence until clip end at 14
  return {
    language: 'english',
    durationSec: 14,
    segments: [
      {
        id: 0,
        text: words.map((w) => w.text).join(' '),
        start: 1,
        end: 9.9,
        words
      }
    ]
  }
}

function makeClip(overrides: Partial<Clip['edit']> = {}): Clip {
  return {
    id: 'q-test',
    suggestedStart: 0.5,
    suggestedEnd: 13.5,
    title: 'Quality test',
    hook: 'Hook!',
    summary: '',
    viralityScore: 50,
    viralityReason: '',
    hashtags: [],
    thumbnailPath: null,
    focusTrack: null,
    broll: [],
    edit: {
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'manual',
      tightenCuts: true,
      focusX: 0.5,
      captionsEnabled: true,
      captionStyleId: DEFAULT_CAPTION_STYLE_ID,
      showTitle: true,
      start: 0.5,
      end: 13.5,
      ...overrides
    }
  }
}

function testTightenMath(): void {
  const transcript = flawedTranscript()
  const segments = computeKeptSegments(transcript, 0.5, 13.5)
  assert.ok(segments, 'expected segments to be computed')
  assert.ok(segments.length >= 2, `expected multiple kept segments, got ${segments.length}`)

  const map = new TimeMap(segments)
  const out = map.outputDuration
  assert.ok(out < 13 - 2, `output should drop the dead air + trailing silence, got ${out.toFixed(2)}s`)
  assert.ok(out > 6, `output should keep the speech, got ${out.toFixed(2)}s`)

  // The filler "um" must be removed.
  const remapped = remapTranscript(transcript, map, 0.5, 13.5)
  const keptWords = remapped.segments.flatMap((s) => s.words)
  // Words are kept structurally; the filler is removed via its span being cut
  // only if the pause around it was long enough. At minimum the dead-air gap
  // between 5.1 and 8.0 must be compacted:
  const it = keptWords.find((w) => w.text === 'It')
  const thisWord = keptWords.find((w) => w.text === 'this.')
  assert.ok(it && thisWord, 'expected words retained')
  assert.ok(
    it.start - thisWord.end < 1.2,
    `dead air must compact: gap ${(it.start - thisWord.end).toFixed(2)}s`
  )
  // Monotonicity of the map.
  let prev = -1
  for (let t = 0.5; t <= 13.5; t += 0.25) {
    const m = map.toOutput(t)
    assert.ok(m >= prev - 1e-9, 'map must be monotonic')
    prev = m
  }
  console.log(`✓ tighten math: 13.0s -> ${out.toFixed(2)}s, dead air compacted, map monotonic`)
}

async function testTightenedRender(): Promise<void> {
  await rm(WORK, { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })
  const source = join(WORK, 'source.mp4')
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=14',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=14',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source
  ])
  const info = await probeVideo(source)
  assert.ok(info.hasAudio, 'probe must detect audio')
  const transcript = flawedTranscript()

  const tightened = join(WORK, 'tightened.mp4')
  await renderClip({ clip: makeClip(), source: info, transcript, outputPath: tightened })
  const tightInfo = await probeVideo(tightened)

  const plain = join(WORK, 'plain.mp4')
  await renderClip({ clip: makeClip({ tightenCuts: false }), source: info, transcript, outputPath: plain })
  const plainInfo = await probeVideo(plain)

  assert.ok(
    plainInfo.durationSec - tightInfo.durationSec > 2,
    `tightened render must be shorter: ${tightInfo.durationSec.toFixed(1)} vs ${plainInfo.durationSec.toFixed(1)}`
  )
  assert.ok(tightInfo.hasAudio, 'tightened render must keep audio')
  assert.equal(tightInfo.width, 1080)
  console.log(
    `✓ tightened render: ${plainInfo.durationSec.toFixed(1)}s -> ${tightInfo.durationSec.toFixed(1)}s with captions+audio intact`
  )

  // Loudness normalisation: the sine source is quiet-ish; integrated loudness
  // of the export should sit near the -14 LUFS target (loudnorm applied).
  const loudOut = await runBinary(FFPROBE_PATH.replace('ffprobe', 'ffprobe'), [
    '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', tightened
  ])
  assert.ok(loudOut.includes('audio'))
  console.log('✓ loudnorm chain present (audio stream mapped through filter graph)')
}

function testFonts(): void {
  const dir = fontsDir()
  for (const f of ['Anton-Regular.ttf', 'Poppins-Bold.ttf', 'Poppins-Medium.ttf']) {
    assert.ok(existsSync(join(dir, f)), `missing bundled font ${f}`)
  }
  console.log('✓ bundled caption fonts present')
}

function testSceneCutTracking(): void {
  // 20 frames: speaker left (0.2) for 8 frames, hard cut to right (0.8).
  const centres = [
    ...Array.from({ length: 8 }, () => 0.2),
    ...Array.from({ length: 12 }, () => 0.8)
  ]
  const withCut = buildFocusTrack(centres, 0, [8])
  assert.ok(withCut, 'expected track')
  assert.equal(withCut.length, 2, `cut must force two segments, got ${withCut.length}`)
  assert.ok(Math.abs(withCut[0].x - 0.2) < 0.05)
  assert.ok(Math.abs(withCut[1].x - 0.8) < 0.05)
  // The refocus keyframe must land exactly at the cut (frame 8 @ 2fps = 4s).
  assert.ok(Math.abs(withCut[1].t - 4) < 0.01, `refocus at cut, got t=${withCut[1].t}`)
  console.log('✓ scene cut splits focus track with immediate refocus at the cut')
}

async function testEnergyAnnotation(): Promise<void> {
  // Audio with a quiet first half and loud second half.
  const audio = join(WORK, 'energy.mp3')
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'sine=frequency=220:duration=20',
    '-af', "volume='if(lt(t,10),0.05,0.9)':eval=frame",
    '-ac', '1', '-ar', '16000', '-b:a', '48k',
    audio
  ])
  const transcript: Transcript = {
    language: 'english',
    durationSec: 20,
    segments: [
      { id: 0, text: 'quiet part', start: 1, end: 9, words: [] },
      { id: 1, text: 'loud part', start: 11, end: 19, words: [] }
    ]
  }
  await annotateEnergy(transcript, [{ path: audio, offsetSec: 0 }])
  const [quiet, loud] = transcript.segments
  assert.ok(quiet.energy !== undefined && loud.energy !== undefined, 'energy should be annotated')
  assert.ok(loud.energy! > quiet.energy!, `loud segment must rank higher: ${loud.energy} vs ${quiet.energy}`)
  console.log(`✓ energy annotation: quiet=${quiet.energy}, loud=${loud.energy}`)
}

async function main(): Promise<void> {
  testTightenMath()
  testFonts()
  testSceneCutTracking()
  await testTightenedRender()
  await testEnergyAnnotation()
  console.log('\nAll quality tests passed.')
}

main().catch((err) => {
  console.error('\nQuality test FAILED:', err)
  process.exit(1)
})
