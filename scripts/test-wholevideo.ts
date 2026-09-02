/**
 * Offline tests for "caption whole video": the full-length clip defaults, and
 * a real render of one.
 *
 * The render is the point. A whole-video clip carries a speaker track and a
 * zoom plan spanning the entire video, and ffmpeg's expression parser gives up
 * at around 85 pieces however they are arranged — so long tracks are driven by
 * a sendcmd script instead, and long graphs are handed to ffmpeg as a file.
 * This exercises both, and checks the rendered crop really lands where the
 * shared focus sampling (the same code the live preview uses) says it should.
 *
 * Run with: npx tsx --tsconfig tsconfig.node.json scripts/test-wholevideo.ts
 */
import { readFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { probeVideo, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { buildFilterGraph, buildFocusPlan, renderClip } from '../src/main/pipeline/render'
import { computeZoomEvents, remapZoomEvents } from '../src/shared/zoom'
import { compactFocusTrack, focusAt } from '../src/shared/focusTrack'
import { wholeVideoEdit } from '../src/shared/wholeVideo'
import type { Clip, FocusKeyframe, Transcript, TranscriptSegment, VideoInfo } from '../src/shared/types'

const WORK = join(process.cwd(), '.tmp', 'wholevideo-test')
const DURATION = 40
/** Graphs longer than this go to ffmpeg as a script file (see render.ts). */
const FILTER_ARG_MAX_CHARS = 8000
/** Pieces one ffmpeg expression may hold before it must be driven another way. */
const MAX_EXPRESSION_PIECES = 64

/**
 * A speaker track over the whole video with a keyframe every `stepSec`, the
 * speaker alternating between the left and right thirds of the frame.
 */
function focusTrack(stepSec: number): FocusKeyframe[] {
  const track: FocusKeyframe[] = []
  for (let t = 0; t < DURATION; t += stepSec) {
    const step = Math.round(t / stepSec)
    track.push({ t, x: step % 2 === 0 ? 0.32 : 0.71, cut: true })
  }
  return compactFocusTrack(track)
}

/** Sentences across the whole video, every other one loud enough to punch on. */
function fullVideoTranscript(): Transcript {
  const segments: TranscriptSegment[] = []
  const line = 'this is the bit that really matters here'
  for (let i = 0; i * 4 < DURATION - 4; i++) {
    const start = i * 4 + 0.5
    segments.push({
      id: i,
      text: line,
      start,
      end: start + 3,
      energy: i % 2 === 0 ? 0.9 : 0.4,
      words: line.split(' ').map((text, w) => ({
        text,
        start: start + w * 0.3,
        end: start + w * 0.3 + 0.28
      }))
    })
  }
  return { language: 'english', durationSec: DURATION, segments }
}

function wholeVideoClip(track: FocusKeyframe[]): Clip {
  return {
    id: 'wv-test',
    origin: 'whole-video',
    suggestedStart: 0,
    suggestedEnd: DURATION,
    title: 'Whole video test',
    hook: '',
    summary: '',
    viralityScore: 0,
    viralityReason: '',
    visualSummary: null,
    hashtags: [],
    thumbnailPath: null,
    focusTrack: track,
    contentType: 'speaker',
    broll: [],
    edit: wholeVideoEdit({
      aspect: '9:16',
      autoZoom: true,
      durationSec: DURATION,
      focusTrack: track,
      contentType: 'speaker'
    })
  }
}

/**
 * Source whose left half is red and right half blue, so where the crop landed
 * can be read straight off a rendered frame.
 */
async function makeHalvesSource(): Promise<VideoInfo> {
  const path = join(WORK, 'halves.mp4')
  await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', `color=c=red:s=960x1080:d=${DURATION},pad=1920:1080:0:0`,
    '-f', 'lavfi', '-i', `color=c=blue:s=960x1080:d=${DURATION}`,
    '-f', 'lavfi', '-i', `sine=frequency=300:duration=${DURATION}`,
    '-filter_complex', '[0:v][1:v]overlay=960:0[v]',
    '-map', '[v]', '-map', '2:a',
    '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', path
  ])
  return probeVideo(path)
}

/** Whole-frame average colour of the frame at `atSec`. */
async function frameColour(videoPath: string, atSec: number): Promise<{ r: number; b: number }> {
  const raw = join(WORK, `px-${atSec.toFixed(2)}.raw`)
  await runFfmpeg([
    '-y',
    '-ss', atSec.toFixed(3),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', 'scale=1:1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    raw
  ])
  const px = await readFile(raw)
  return { r: px[0], b: px[2] }
}

async function main(): Promise<void> {
  await rm(WORK, { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })

  const source = await makeHalvesSource()
  const transcript = fullVideoTranscript()

  // 1. Defaults.
  const short = wholeVideoClip(focusTrack(1.5))
  assert.equal(short.edit.start, 0, 'a whole-video clip starts at the top')
  assert.equal(short.edit.end, DURATION, 'and runs to the end')
  assert.equal(short.edit.captionsEnabled, true, 'captions are the point of the mode')
  assert.equal(short.edit.tightenCuts, false, 'tighten stays off across a whole video')
  assert.equal(short.edit.framing, 'auto', 'a tracked clip follows the speaker')
  console.log(`✓ whole-video defaults: 0-${DURATION}s, captions on, tighten off, auto framing`)

  // 2. A track that fits stays one expression; a long one becomes commands.
  const fitsPlan = buildFocusPlan(short, true)
  assert.equal(fitsPlan.commands, null, 'a short track needs no commands')
  assert.ok(fitsPlan.x.includes('gte(t,'), 'and is a piecewise expression')

  const clip = wholeVideoClip(focusTrack(0.5))
  const keyframes = clip.focusTrack!.length
  assert.ok(keyframes > MAX_EXPRESSION_PIECES, `expected a long track, got ${keyframes}`)
  const longPlan = buildFocusPlan(clip, true)
  assert.ok(longPlan.commands, 'a long track must be driven by commands')
  assert.equal(longPlan.commands!.split('\n').length, keyframes, 'one command per keyframe')
  assert.ok(!longPlan.x.includes('gte(t,'), 'the crop starts on a constant, not a huge expression')
  console.log(`✓ ${keyframes} keyframes -> ${keyframes} crop commands instead of one expression`)

  // Without somewhere to put the commands, the track is thinned to fit.
  const thinned = buildFocusPlan(clip, false)
  assert.equal(thinned.commands, null)
  assert.ok(
    (thinned.x.match(/gte\(t,/g) ?? []).length <= MAX_EXPRESSION_PIECES,
    'the fallback expression must stay within the parser budget'
  )
  console.log('✓ with no command file the expression falls back to a thinned track')

  // 3. The graph drives the crop and hands back the commands to write.
  const zoomEvents = remapZoomEvents(computeZoomEvents(transcript, 0, DURATION, null), (t) => t)
  const graph = buildFilterGraph(clip, source, null, DURATION, null, {
    zoomEvents,
    focusCommandsPath: join(WORK, 'focus.cmd')
  })
  assert.ok(graph.filterComplex.includes('sendcmd=f='), 'the graph must drive the crop')
  assert.ok(graph.focusCommands, 'and hand back the commands to write')
  console.log(`✓ graph drives the crop by command file (${graph.filterComplex.length} chars)`)

  // 4. Render it, and check the crop landed where the shared sampling says.
  const outputPath = join(WORK, 'captioned.mp4')
  const progress: number[] = []
  await renderClip({
    clip,
    source,
    transcript,
    outputPath,
    quality: 'draft',
    onProgress: (f) => progress.push(f)
  })
  const rendered = await probeVideo(outputPath)
  assert.equal(rendered.width, 1080, 'vertical output width')
  assert.equal(rendered.height, 1920, 'vertical output height')
  assert.ok(rendered.hasAudio, 'render must keep audio')
  assert.ok(
    Math.abs(rendered.durationSec - DURATION) < 1.5,
    `render must cover the whole video, got ${rendered.durationSec.toFixed(1)}s`
  )
  assert.ok(progress.length > 0, 'render must report progress')
  console.log(
    `✓ rendered ${rendered.width}x${rendered.height} ${rendered.durationSec.toFixed(1)}s with captions, speaker track and auto zoom`
  )

  // Probe a moment inside several keyframes, well after each one starts so any
  // pan has settled.
  for (const at of [1.2, 1.7, 10.2, 20.7, 33.2, 39.2]) {
    const expected = focusAt(clip.focusTrack!, at)
    const colour = await frameColour(outputPath, at)
    const onLeft = colour.r > colour.b
    assert.equal(
      onLeft,
      expected < 0.5,
      `at ${at}s the crop should sit at x=${expected.toFixed(2)} ` +
        `(${expected < 0.5 ? 'left/red' : 'right/blue'}) but the frame read r=${colour.r} b=${colour.b}`
    )
  }
  console.log('✓ the rendered crop follows the speaker track, frame by frame')

  // 5. A graph too long to pass as a command-line argument goes to ffmpeg as a
  // script file. Dense within-shot pans make one cheaply: each is a smoothstep
  // piece several hundred characters long.
  const pans: FocusKeyframe[] = Array.from({ length: MAX_EXPRESSION_PIECES }, (_, i) => ({
    t: i * 0.09,
    x: 0.5 + (i % 2 === 0 ? -0.02 : 0.02)
  }))
  const panClip: Clip = {
    ...wholeVideoClip(pans),
    suggestedEnd: 6,
    edit: { ...wholeVideoClip(pans).edit, end: 6, captionsEnabled: false }
  }
  const panGraph = buildFilterGraph(panClip, source, null, 6, null, {
    focusCommandsPath: join(WORK, 'focus2.cmd')
  })
  assert.equal(panGraph.focusCommands, null, 'a track this size still fits one expression')
  assert.ok(
    panGraph.filterComplex.length > FILTER_ARG_MAX_CHARS,
    `expected a graph past the argument threshold, got ${panGraph.filterComplex.length} chars`
  )
  const panPath = join(WORK, 'pans.mp4')
  await renderClip({ clip: panClip, source, transcript: null, outputPath: panPath, quality: 'draft' })
  const panRendered = await probeVideo(panPath)
  assert.equal(panRendered.width, 1080)
  assert.ok(Math.abs(panRendered.durationSec - 6) < 1)
  console.log(
    `✓ a ${panGraph.filterComplex.length}-char graph renders via ffmpeg's filter script file`
  )

  await rm(WORK, { recursive: true, force: true })
  console.log('\nAll whole-video tests passed.')
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
