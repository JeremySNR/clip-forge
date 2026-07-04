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
  const fullArgs = ['-hide_banner', '-y', ...args]
  if (opts.onProgress) fullArgs.push('-progress', 'pipe:1', '-nostats')
  return runBinary(FFMPEG_PATH, fullArgs, opts)
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
    sizeBytes: Number(data.format?.size ?? 0)
  }
}

/**
 * Extract mono compressed audio for transcription, split into chunks that stay
 * safely under the OpenAI 25 MB upload limit. 48 kbps mono MP3 ≈ 21.6 MB/hour,
 * so 20-minute chunks (~7.2 MB) leave plenty of headroom.
 */
export async function extractAudioChunks(
  videoPath: string,
  workDir: string,
  durationSec: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<Array<{ path: string; offsetSec: number }>> {
  await mkdir(workDir, { recursive: true })
  const CHUNK_SEC = 20 * 60
  const chunks: Array<{ path: string; offsetSec: number }> = []
  const count = Math.max(1, Math.ceil(durationSec / CHUNK_SEC))
  for (let i = 0; i < count; i++) {
    const offset = i * CHUNK_SEC
    const out = join(workDir, `audio-${i}.mp3`)
    const args = [
      '-ss', String(offset),
      '-t', String(CHUNK_SEC),
      '-i', videoPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '48k',
      out
    ]
    const chunkDur = Math.min(CHUNK_SEC, durationSec - offset)
    await runFfmpeg(args, {
      onProgress: (t) => onProgress?.((offset + Math.min(t, chunkDur)) / durationSec),
      signal
    })
    chunks.push({ path: out, offsetSec: offset })
  }
  onProgress?.(1)
  return chunks
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
