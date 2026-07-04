import { open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Transcript } from '@shared/types'
import { runFfmpeg } from './ffmpeg'

/**
 * Vocal-energy analysis. Research on sharing behaviour (Berger 2011,
 * "Arousal Increases Social Transmission of Information") shows physiological
 * arousal drives transmission — and delivery energy is the strongest audible
 * proxy a transcript can't capture. We compute per-second RMS loudness from
 * the already-extracted audio and attach a relative energy percentile to each
 * transcript segment, which the highlight prompt then surfaces to the LLM.
 */

const SAMPLE_RATE = 16000
const BYTES_PER_SAMPLE = 2

/** Decode an audio file to mono 16k PCM and return per-second RMS values. */
async function perSecondRms(audioPath: string): Promise<number[]> {
  const pcmPath = join(tmpdir(), 'clipforge', `energy-${randomUUID()}.pcm`)
  await runFfmpeg([
    '-i', audioPath,
    '-ac', '1',
    '-ar', String(SAMPLE_RATE),
    '-f', 's16le',
    pcmPath
  ])
  try {
    const rms: number[] = []
    const file = await open(pcmPath, 'r')
    try {
      const chunkBytes = SAMPLE_RATE * BYTES_PER_SAMPLE // one second
      const buffer = Buffer.alloc(chunkBytes)
      for (;;) {
        const { bytesRead } = await file.read(buffer, 0, chunkBytes)
        if (bytesRead < BYTES_PER_SAMPLE) break
        let sum = 0
        const samples = Math.floor(bytesRead / BYTES_PER_SAMPLE)
        for (let i = 0; i < samples; i++) {
          const v = buffer.readInt16LE(i * BYTES_PER_SAMPLE) / 32768
          sum += v * v
        }
        rms.push(Math.sqrt(sum / samples))
        if (bytesRead < chunkBytes) break
      }
    } finally {
      await file.close()
    }
    return rms
  } finally {
    await rm(pcmPath, { force: true }).catch(() => undefined)
  }
}

/**
 * Attach a relative energy value (0..1 percentile within this video) to each
 * transcript segment. Mutates the transcript. Failures are non-fatal — the
 * pipeline works fine without energy annotations.
 */
export async function annotateEnergy(
  transcript: Transcript,
  audioChunks: Array<{ path: string; offsetSec: number }>
): Promise<void> {
  try {
    // Assemble a global per-second RMS timeline across chunks.
    const timeline: number[] = []
    for (const chunk of audioChunks) {
      const rms = await perSecondRms(chunk.path)
      for (let i = 0; i < rms.length; i++) {
        timeline[Math.floor(chunk.offsetSec) + i] = rms[i]
      }
    }
    // Adaptive noise gate: silence detection relative to this video's own
    // peak level, so quiet recordings still get useful percentiles.
    const allLevels = timeline.filter((v): v is number => v !== undefined)
    if (allLevels.length < 10) return
    const peak = Math.max(...allLevels)
    const gate = Math.max(0.002, peak * 0.03)
    const speechLevels = allLevels.filter((v) => v > gate)
    if (speechLevels.length < 10) return
    const sorted = [...speechLevels].sort((a, b) => a - b)
    const percentile = (v: number): number => {
      let lo = 0
      let hi = sorted.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (sorted[mid] < v) lo = mid + 1
        else hi = mid
      }
      return lo / sorted.length
    }

    for (const seg of transcript.segments) {
      const from = Math.max(0, Math.floor(seg.start))
      const to = Math.min(timeline.length - 1, Math.ceil(seg.end))
      let sum = 0
      let count = 0
      for (let s = from; s <= to; s++) {
        const v = timeline[s]
        if (v !== undefined && v > gate) {
          sum += v
          count++
        }
      }
      if (count > 0) seg.energy = Math.round(percentile(sum / count) * 100) / 100
    }
  } catch (err) {
    console.error('Energy annotation failed (continuing without it):', err)
  }
}
