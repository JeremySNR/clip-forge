import { existsSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { SpeechRegion } from '@shared/types'
import { runInference } from '../inference/client'
import type { TensorData } from '../inference/protocol'
import { runFfmpeg } from './ffmpeg'
import { modelsDir } from './detect'
import { timed } from './timing'

/**
 * Voice activity detection with Silero VAD v5 (MIT, snakers4/silero-vad).
 *
 * Word timestamps say roughly where words are; they are not acoustic
 * boundaries. Speech regions let pause removal and clip boundaries cut in
 * actual silence instead of inside a syllable or breath. The model runs in
 * the inference child over ten-minute windows of 16 kHz PCM, carrying its
 * recurrent state across windows.
 */

const MODEL = 'silero-vad.onnx'
const SAMPLE_RATE = 16000
const CHUNK = 512
const CHUNK_SEC = CHUNK / SAMPLE_RATE
const WINDOW_SAMPLES = CHUNK * Math.floor((600 * SAMPLE_RATE) / CHUNK)
/** Silero's reference post-processing (get_speech_timestamps defaults). */
const THRESHOLD = 0.5
const NEG_THRESHOLD = 0.35
const MIN_SPEECH_SEC = 0.25
const MIN_SILENCE_SEC = 0.1
const SPEECH_PAD_SEC = 0.03

export function vadAvailable(): boolean {
  return existsSync(join(modelsDir(), MODEL))
}

/** Hysteresis over chunk probabilities into padded, merged speech regions. */
export function speechRegions(probs: ArrayLike<number>, chunkSec = CHUNK_SEC, durationSec = probs.length * chunkSec): SpeechRegion[] {
  const raw: SpeechRegion[] = []
  let start = -1, silenceStart = -1
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i]
    if (start < 0) {
      if (p >= THRESHOLD) { start = i; silenceStart = -1 }
      continue
    }
    if (p >= THRESHOLD) { silenceStart = -1; continue }
    if (p < NEG_THRESHOLD) {
      if (silenceStart < 0) silenceStart = i
      if ((i - silenceStart) * chunkSec >= MIN_SILENCE_SEC) {
        raw.push({ start: start * chunkSec, end: silenceStart * chunkSec })
        start = -1; silenceStart = -1
      }
    }
  }
  if (start >= 0) raw.push({ start: start * chunkSec, end: (silenceStart >= 0 ? silenceStart : probs.length) * chunkSec })
  const out: SpeechRegion[] = []
  for (const region of raw) {
    if (region.end - region.start < MIN_SPEECH_SEC) continue
    const padded = { start: Math.max(0, region.start - SPEECH_PAD_SEC), end: Math.min(durationSec, region.end + SPEECH_PAD_SEC) }
    const previous = out[out.length - 1]
    if (previous && padded.start <= previous.end) previous.end = Math.max(previous.end, padded.end)
    else out.push(padded)
  }
  return out.map(r => ({ start: Math.round(r.start * 1000) / 1000, end: Math.round(r.end * 1000) / 1000 }))
}

/** Speech regions for a whole video's first audio track, in source seconds. */
export async function detectSpeech(videoPath: string, signal?: AbortSignal): Promise<SpeechRegion[]> {
  const pcmPath = join(tmpdir(), 'cutawan', `vad-${randomUUID()}.pcm`)
  try {
    await timed('vad/audio', () => runFfmpeg(['-i', videoPath, '-map', '0:a:0', '-vn', '-ac', '1',
      '-ar', String(SAMPLE_RATE), '-f', 's16le', pcmPath], { signal }))
    const samples = Math.floor((await stat(pcmPath)).size / 2)
    const probs = new Float32Array(Math.floor(samples / CHUNK))
    await timed('vad/model', async () => {
      let state: TensorData = { data: new Float32Array(2 * 128), dims: [2, 1, 128] }
      let context: TensorData = { data: new Float32Array(64), dims: [64] }
      for (let from = 0; from < samples; from += WINDOW_SAMPLES) {
        signal?.throwIfAborted()
        const out = await runInference(join(modelsDir(), MODEL), { state, context }, signal,
          { pcmPath, fromSample: from, sampleCount: Math.min(WINDOW_SAMPLES, samples - from) })
        probs.set(out.probs.data, from / CHUNK)
        state = out.state
        context = out.context
      }
    }, { audioSec: Math.round(samples / SAMPLE_RATE) })
    return speechRegions(probs, CHUNK_SEC, samples / SAMPLE_RATE)
  } finally {
    await rm(pcmPath, { force: true }).catch(() => undefined)
  }
}
