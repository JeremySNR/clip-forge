import { runInference } from '../inference/client'

export const FRONTEND_BATCH_FRAMES = 25
// Three temporal convolution blocks, each with kernels 5 and 3: radius 9.
// The audio encoder's receptive field is smaller in video-frame units.
export const FRONTEND_CONTEXT_FRAMES = 9
const CROP_SIZE = 112
const EMBEDDING_SIZE = 128
const AUDIO_COEFFICIENTS = 13

export function frontendWindows(frames: number): Array<{ from: number; to: number; inputFrom: number; inputTo: number }> {
  const windows = []
  for (let from = 0; from < frames; from += FRONTEND_BATCH_FRAMES) {
    const to = Math.min(frames, from + FRONTEND_BATCH_FRAMES)
    windows.push({ from, to, inputFrom: Math.max(0, from - FRONTEND_CONTEXT_FRAMES),
      inputTo: Math.min(frames, to + FRONTEND_CONTEXT_FRAMES) })
  }
  return windows
}

/** Bound convolution workspaces while retaining the full temporal receptive field. */
export async function encodeFaceTrack(
  modelPath: string, crops: Uint8Array[], audio: Float32Array, signal?: AbortSignal
): Promise<{ embedA: Float32Array; embedV: Float32Array }> {
  const embedA = new Float32Array(crops.length * EMBEDDING_SIZE)
  const embedV = new Float32Array(crops.length * EMBEDDING_SIZE)
  for (const { from, to, inputFrom, inputTo } of frontendWindows(crops.length)) {
    signal?.throwIfAborted()
    const frames = inputTo - inputFrom
    const video = new Float32Array(frames * CROP_SIZE * CROP_SIZE)
    for (let i = inputFrom; i < inputTo; i++) video.set(crops[i], (i - inputFrom) * CROP_SIZE * CROP_SIZE)
    const outputs = await runInference(modelPath, {
      audio: { data: audio.slice(inputFrom * 4 * AUDIO_COEFFICIENTS, inputTo * 4 * AUDIO_COEFFICIENTS),
        dims: [1, frames * 4, AUDIO_COEFFICIENTS] },
      video: { data: video, dims: [1, frames, CROP_SIZE, CROP_SIZE] }
    }, signal)
    const offset = (from - inputFrom) * EMBEDDING_SIZE
    const length = (to - from) * EMBEDDING_SIZE
    embedA.set(outputs.embedA.data.subarray(offset, offset + length), from * EMBEDDING_SIZE)
    embedV.set(outputs.embedV.data.subarray(offset, offset + length), from * EMBEDDING_SIZE)
  }
  return { embedA, embedV }
}
