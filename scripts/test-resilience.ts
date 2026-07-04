/**
 * Offline resilience tests: retry/backoff behaviour, clip dedup, and
 * cancellation of ffmpeg-backed operations. No API key required.
 *
 * Run with: npx tsx --tsconfig tsconfig.node.json scripts/test-resilience.ts
 */
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { withRetries, OpenAIError } from '../src/main/pipeline/openai'
import { dedupeClips } from '../src/main/pipeline/highlights'
import { extractAudioChunks, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { DEFAULT_CAPTION_STYLE_ID } from '../src/shared/captionStyles'
import type { Clip } from '../src/shared/types'

const WORK = join(process.cwd(), '.tmp', 'resilience-test')

function fakeClip(start: number, end: number, score: number): Clip {
  return {
    id: `clip-${start}-${end}`,
    suggestedStart: start,
    suggestedEnd: end,
    title: 't',
    hook: 'h',
    summary: 's',
    viralityScore: score,
    viralityReason: 'r',
    hashtags: [],
    thumbnailPath: null,
    focusTrack: null,
    broll: [],
    edit: {
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'manual',
      tightenCuts: false,
      focusX: 0.5,
      captionsEnabled: true,
      captionStyleId: DEFAULT_CAPTION_STYLE_ID,
      showTitle: false,
      start,
      end
    }
  }
}

async function testRetries(): Promise<void> {
  // Transient failures are retried until success.
  let calls = 0
  const result = await withRetries(
    async () => {
      calls++
      if (calls < 3) throw new OpenAIError('Analysis failed (HTTP 500)', 500)
      return 'ok'
    },
    { baseDelayMs: 10 }
  )
  assert.equal(result, 'ok')
  assert.equal(calls, 3)
  console.log('✓ retries transient failures until success')

  // Rate limits (429) are retryable.
  calls = 0
  await withRetries(
    async () => {
      calls++
      if (calls === 1) throw new OpenAIError('rate limited', 429)
      return 'ok'
    },
    { baseDelayMs: 10 }
  )
  assert.equal(calls, 2)
  console.log('✓ retries rate limits')

  // Non-retryable client errors fail immediately.
  calls = 0
  await assert.rejects(
    withRetries(
      async () => {
        calls++
        throw new OpenAIError('bad key', 401)
      },
      { baseDelayMs: 10 }
    ),
    /bad key/
  )
  assert.equal(calls, 1)
  console.log('✓ does not retry auth/client errors')

  // Attempts are bounded.
  calls = 0
  await assert.rejects(
    withRetries(
      async () => {
        calls++
        throw new Error('network down')
      },
      { attempts: 3, baseDelayMs: 10 }
    ),
    /network down/
  )
  assert.equal(calls, 3)
  console.log('✓ gives up after the attempt budget')

  // Abort short-circuits both the call and the backoff sleep.
  const controller = new AbortController()
  calls = 0
  const pending = withRetries(
    async () => {
      calls++
      throw new Error('flaky')
    },
    { attempts: 10, baseDelayMs: 60_000, signal: controller.signal }
  )
  setTimeout(() => controller.abort(), 50)
  await assert.rejects(pending)
  assert.ok(calls <= 2, `expected abort to stop retries, got ${calls} calls`)
  console.log('✓ abort cancels pending retries')
}

function testDedup(): void {
  // Sorted by score descending, as detectHighlights produces.
  const clips = [
    fakeClip(10, 40, 90), // keep
    fakeClip(12, 38, 85), // ~87% overlap with #1 -> dropped
    fakeClip(35, 65, 80), // 5s/30s overlap with #1 -> keep
    fakeClip(100, 130, 75), // disjoint -> keep
    fakeClip(101, 128, 70) // nested in #4 -> dropped
  ]
  const deduped = dedupeClips(clips)
  assert.deepEqual(
    deduped.map((c) => c.id),
    ['clip-10-40', 'clip-35-65', 'clip-100-130']
  )
  console.log('✓ dedup drops overlapping lower-scored clips')
}

async function testAbortFfmpeg(): Promise<void> {
  await rm(WORK, { recursive: true, force: true })
  await mkdir(WORK, { recursive: true })
  const source = join(WORK, 'source.mp4')
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source
  ])

  // A pre-aborted signal rejects without doing any work.
  const aborted = AbortSignal.abort()
  await assert.rejects(extractAudioChunks(source, join(WORK, 'audio'), 30, undefined, aborted))
  console.log('✓ pre-aborted signal rejects audio extraction')

  // Mid-flight abort kills the ffmpeg process promptly. `-re` throttles
  // ffmpeg to realtime so the 30s encode is guaranteed to still be running.
  const controller = new AbortController()
  const started = Date.now()
  const pending = runFfmpeg(
    ['-re', '-i', source, '-c:v', 'libx264', '-preset', 'veryfast', join(WORK, 'slow.mp4')],
    { signal: controller.signal }
  )
  setTimeout(() => controller.abort(), 300)
  await assert.rejects(pending)
  assert.ok(Date.now() - started < 5000, 'abort should kill ffmpeg promptly')
  console.log('✓ abort kills in-flight ffmpeg work')
}

async function main(): Promise<void> {
  await testRetries()
  testDedup()
  await testAbortFfmpeg()
  console.log('\nAll resilience tests passed.')
}

main().catch((err) => {
  console.error('\nResilience test FAILED:', err)
  process.exit(1)
})
