import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { VideoInfo } from '@shared/types'

/** When packaged inside app.asar, binaries live in the unpacked twin directory. */
function unpacked(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}

export const FFMPEG_PATH = unpacked(ffmpegStatic ?? 'ffmpeg')
export const FFPROBE_PATH = unpacked(ffprobeStatic.path)

export interface RunOptions {
  /** Called with parsed "out_time" seconds while ffmpeg reports -progress. */
  onProgress?: (outTimeSec: number) => void
  signal?: AbortSignal
}

export function runBinary(bin: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, signal: opts.signal })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
      if (opts.onProgress) {
        // -progress pipe:1 emits lines like "out_time_ms=1234567"
        const matches = stdout.match(/out_time_ms=(\d+)/g)
        if (matches && matches.length > 0) {
          const last = matches[matches.length - 1]
          const us = Number(last.slice('out_time_ms='.length))
          opts.onProgress(us / 1_000_000)
          if (stdout.length > 65536) stdout = stdout.slice(-8192)
        }
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 131072) stderr = stderr.slice(-65536)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${bin.split(/[\\/]/).pop()} exited with code ${code}:\n${stderr.slice(-2000)}`))
    })
  })
}

export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<string> {
  return runFfmpegWith(FFMPEG_PATH, args, opts)
}

/**
 * Run ffmpeg producing raw frames on stdout and invoke `onFrame` for each
 * complete frame of `frameBytes` bytes. Consuming via async iteration gives
 * natural backpressure, so long clips never buffer more than a frame or two
 * in memory. Returns the number of frames emitted.
 */
export async function streamRawFrames(
  args: string[],
  frameBytes: number,
  onFrame: (frame: Buffer, index: number) => void | Promise<void>,
  signal?: AbortSignal
): Promise<number> {
  const child = spawn(FFMPEG_PATH, ['-hide_banner', ...args, 'pipe:1'], {
    windowsHide: true,
    signal
  })
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString()
    if (stderr.length > 65536) stderr = stderr.slice(-32768)
  })
  const exit = new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? -1))
  })

  let pending: Buffer[] = []
  let pendingBytes = 0
  let index = 0
  for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
    pending.push(chunk)
    pendingBytes += chunk.length
    if (pendingBytes < frameBytes) continue
    const merged = pending.length === 1 ? pending[0] : Buffer.concat(pending)
    let offset = 0
    while (merged.length - offset >= frameBytes) {
      await onFrame(merged.subarray(offset, offset + frameBytes), index++)
      offset += frameBytes
    }
    pending = offset < merged.length ? [merged.subarray(offset)] : []
    pendingBytes = merged.length - offset
  }
  const code = await exit
  if (code !== 0) {
    throw new Error(`ffmpeg frame stream exited with code ${code}:\n${stderr.slice(-2000)}`)
  }
  return index
}

/** Like runFfmpeg but with an explicit binary (e.g. a GPU-enabled build). */
export function runFfmpegWith(bin: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const fullArgs = ['-hide_banner', '-y', ...args]
  if (opts.onProgress) fullArgs.push('-progress', 'pipe:1', '-nostats')
  return runBinary(bin, fullArgs, opts)
}

export async function probeVideo(filePath: string): Promise<VideoInfo> {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
  const out = await runBinary(FFPROBE_PATH, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ])
  const data = JSON.parse(out) as {
    format?: { duration?: string; size?: string }
    streams?: Array<{
      codec_type?: string
      width?: number
      height?: number
      avg_frame_rate?: string
      duration?: string
    }>
  }
  const video = data.streams?.find((s) => s.codec_type === 'video')
  if (!video) throw new Error('No video stream found in file')
  const hasAudio = data.streams?.some((s) => s.codec_type === 'audio') ?? false
  const fpsRaw = video.avg_frame_rate ?? '30/1'
  const [num, den] = fpsRaw.split('/').map(Number)
  const fps = den > 0 ? num / den : 30
  const durationSec = Number(data.format?.duration ?? video.duration ?? 0)
  if (!durationSec || durationSec <= 0) throw new Error('Could not determine video duration')
  return {
    path: filePath,
    fileName: filePath.split(/[\\/]/).pop() ?? filePath,
    durationSec,
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: Math.round(fps * 100) / 100,
    sizeBytes: Number(data.format?.size ?? 0),
    hasAudio
  }
}

export interface AudioChunk {
  path: string
  /** Where this chunk's audio starts in the source video (seconds). */
  offsetSec: number
  /**
   * The half-open window [keepFromSec, keepToSec) of source time this chunk is
   * responsible for when stitching transcripts. Chunks overlap so words near a
   * boundary are transcribed with full context; the windows tile exactly, so
   * every word belongs to exactly one chunk.
   */
  keepFromSec: number
  keepToSec: number
}

/**
 * Extract mono compressed audio for transcription, split into chunks that stay
 * safely under the OpenAI 25 MB upload limit. 48 kbps mono MP3 ≈ 21.6 MB/hour,
 * so 20-minute chunks (~7.2 MB) leave plenty of headroom. Consecutive chunks
 * overlap by a few seconds so no word is cut in half at a boundary — Whisper
 * sees full context on both sides and the stitcher picks each word from the
 * chunk that owns its timestamp.
 */
export const AUDIO_CHUNK_SEC = 20 * 60
export const AUDIO_CHUNK_OVERLAP_SEC = 8

export async function extractAudioChunks(
  videoPath: string,
  workDir: string,
  durationSec: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<AudioChunk[]> {
  await mkdir(workDir, { recursive: true })
  const stride = AUDIO_CHUNK_SEC - AUDIO_CHUNK_OVERLAP_SEC
  const count =
    durationSec <= AUDIO_CHUNK_SEC ? 1 : 1 + Math.ceil((durationSec - AUDIO_CHUNK_SEC) / stride)
  const chunks: AudioChunk[] = []
  for (let i = 0; i < count; i++) {
    const offset = i * stride
    const out = join(workDir, `audio-${i}.mp3`)
    const args = [
      '-ss', String(offset),
      '-t', String(AUDIO_CHUNK_SEC),
      '-i', videoPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '48k',
      out
    ]
    const chunkDur = Math.min(AUDIO_CHUNK_SEC, durationSec - offset)
    await runFfmpeg(args, {
      onProgress: (t) => onProgress?.(Math.min(1, (offset + Math.min(t, chunkDur)) / durationSec)),
      signal
    })
    chunks.push({
      path: out,
      offsetSec: offset,
      keepFromSec: i === 0 ? 0 : offset + AUDIO_CHUNK_OVERLAP_SEC / 2,
      keepToSec:
        i === count - 1 ? Number.POSITIVE_INFINITY : offset + AUDIO_CHUNK_SEC - AUDIO_CHUNK_OVERLAP_SEC / 2
    })
  }
  onProgress?.(1)
  return chunks
}

/**
 * Re-encode a video to land under `targetBytes`, for uploading to services that
 * cap request body size (e.g. WorkVivo's Customer API, which rejects large
 * inline multipart uploads with HTTP 413). Single-pass H.264 with an average
 * bitrate derived from the clip's duration and a peak cap, optionally
 * downscaling to `maxHeight`. It is not byte-exact, so it aims a little under
 * the target and callers should still be ready to retry with a smaller target.
 * Uses the bundled CPU encoder so it works without a GPU build.
 */
export async function compressToTargetSize(
  inputPath: string,
  outputPath: string,
  targetBytes: number,
  opts: { maxHeight?: number; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}
): Promise<void> {
  const info = await probeVideo(inputPath)
  const audioKbps = 128
  // Aim under the target to leave room for multipart/form overhead and VBR drift.
  const budgetKbits = (targetBytes * 8 * 0.9) / 1000
  const totalKbps = Math.max(1, Math.floor(budgetKbits / info.durationSec))
  const videoKbps = Math.max(200, totalKbps - audioKbps)
  const scale = opts.maxHeight ? ['-vf', `scale=-2:'min(${opts.maxHeight},ih)'`] : []
  await runFfmpeg(
    [
      '-i', inputPath,
      ...scale,
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-b:v', `${videoKbps}k`,
      '-maxrate', `${Math.floor(videoKbps * 1.35)}k`,
      '-bufsize', `${videoKbps * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', `${audioKbps}k`,
      '-movflags', '+faststart',
      outputPath
    ],
    {
      onProgress: (t) => opts.onProgress?.(Math.min(1, t / info.durationSec)),
      signal: opts.signal
    }
  )
}

/** Grab a single frame as a JPEG thumbnail. */
export async function extractThumbnail(
  videoPath: string,
  atSec: number,
  outPath: string,
  maxWidth = 640
): Promise<string> {
  await runFfmpeg([
    '-ss', atSec.toFixed(3),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', `scale='min(${maxWidth},iw)':-2`,
    '-q:v', '4',
    outPath
  ])
  return outPath
}
