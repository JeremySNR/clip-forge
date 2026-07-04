import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { app } from 'electron'
import type { GpuEncoderStatus, ImportProgress, QualityPreference } from '@shared/types'
import { FFMPEG_PATH, runBinary } from './ffmpeg'

/**
 * Hardware (NVENC) export support. The bundled ffmpeg-static binary is built
 * without hardware encoders, so GPU export needs a capable ffmpeg: either one
 * already on the system PATH, or a GPU-enabled static build (BtbN) that the
 * app can download on demand. A candidate binary only counts as "available"
 * after a real NVENC test encode succeeds — having the encoder compiled in
 * does not mean a GPU and driver are present.
 */

const NVENC_ENCODER = 'h264_nvenc'

export interface ResolvedEncoder {
  kind: 'nvenc' | 'cpu'
  /** ffmpeg binary to use for the export. */
  bin: string
}

function userDataDir(): string {
  return app?.getPath?.('userData') ?? join(process.cwd(), '.tmp', 'userData')
}

function gpuFfmpegPath(): string {
  return join(userDataDir(), 'bin', process.platform === 'win32' ? 'ffmpeg-gpu.exe' : 'ffmpeg-gpu')
}

async function hasEncoderCompiled(bin: string): Promise<boolean> {
  try {
    const out = await runBinary(bin, ['-hide_banner', '-encoders'])
    return out.includes(NVENC_ENCODER)
  } catch {
    return false
  }
}

/** Real proof: encode two black frames through NVENC. */
async function nvencWorks(bin: string): Promise<boolean> {
  try {
    await runBinary(bin, [
      '-hide_banner', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.12',
      '-frames:v', '2',
      '-c:v', NVENC_ENCODER,
      '-f', 'null', '-'
    ])
    return true
  } catch {
    return false
  }
}

interface NvencProbe {
  bin: string | null
  /** A binary exists with NVENC compiled in, but the test encode failed. */
  encoderPresentButBroken: boolean
}

let probePromise: Promise<NvencProbe> | null = null

async function probeNvenc(): Promise<NvencProbe> {
  // Candidates in preference order: downloaded GPU build, system ffmpeg.
  const candidates = [gpuFfmpegPath(), 'ffmpeg'].filter(
    (bin) => bin === 'ffmpeg' || existsSync(bin)
  )
  let encoderPresentButBroken = false
  for (const bin of candidates) {
    if (!(await hasEncoderCompiled(bin))) continue
    if (await nvencWorks(bin)) return { bin, encoderPresentButBroken: false }
    encoderPresentButBroken = true
  }
  return { bin: null, encoderPresentButBroken }
}

function getNvencProbe(): Promise<NvencProbe> {
  probePromise ??= probeNvenc()
  return probePromise
}

export function invalidateEncoderCache(): void {
  probePromise = null
}

export async function getGpuStatus(): Promise<GpuEncoderStatus> {
  const canDownload = process.platform === 'linux' || process.platform === 'win32'
  const probe = await getNvencProbe()
  if (probe.bin) {
    return {
      available: true,
      detail:
        probe.bin === 'ffmpeg'
          ? 'NVIDIA NVENC ready (system ffmpeg)'
          : 'NVIDIA NVENC ready (downloaded GPU build)',
      canDownloadFfmpeg: false
    }
  }
  if (probe.encoderPresentButBroken) {
    return {
      available: false,
      detail: 'A GPU-capable ffmpeg was found, but no working NVIDIA GPU/driver was detected.',
      canDownloadFfmpeg: false
    }
  }
  return {
    available: false,
    detail: canDownload
      ? 'The bundled ffmpeg has no GPU encoder. Download a GPU-enabled ffmpeg build to use your NVIDIA card.'
      : 'GPU export requires an ffmpeg with NVENC on your PATH.',
    canDownloadFfmpeg: canDownload
  }
}

export async function resolveEncoder(preference: 'auto' | 'cpu' | 'gpu'): Promise<ResolvedEncoder> {
  if (preference === 'cpu') return { kind: 'cpu', bin: FFMPEG_PATH }
  const probe = await getNvencProbe()
  if (probe.bin) return { kind: 'nvenc', bin: probe.bin }
  if (preference === 'gpu') {
    throw new Error(
      'GPU encoding is not available: no working NVENC ffmpeg was found. Check Settings → Export.'
    )
  }
  return { kind: 'cpu', bin: FFMPEG_PATH }
}

/** Video encoder args for a given encoder kind and quality tier. */
export function encoderArgs(kind: 'nvenc' | 'cpu', quality: QualityPreference): string[] {
  switch (kind) {
    case 'cpu': {
      const preset = quality === 'draft' ? 'veryfast' : quality === 'high' ? 'slow' : 'medium'
      const crf = quality === 'draft' ? '23' : quality === 'high' ? '17' : '19'
      return ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p']
    }
    case 'nvenc': {
      const preset = quality === 'draft' ? 'p4' : quality === 'high' ? 'p7' : 'p5'
      const cq = quality === 'draft' ? '26' : quality === 'high' ? '18' : '21'
      return [
        '-c:v', NVENC_ENCODER,
        '-preset', preset,
        '-tune', 'hq',
        '-rc', 'vbr',
        '-cq', cq,
        '-b:v', '0',
        '-spatial-aq', '1',
        '-temporal-aq', '1',
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p'
      ]
    }
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

export function audioArgs(quality: QualityPreference): string[] {
  return ['-c:a', 'aac', '-b:a', quality === 'high' ? '192k' : '160k']
}

const DOWNLOAD_URLS: Partial<Record<NodeJS.Platform, string>> = {
  linux:
    'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz',
  win32:
    'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip'
}

/** Recursively find the ffmpeg binary inside the extracted archive. */
async function findFfmpegBinary(dir: string): Promise<string | null> {
  const wanted = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name === wanted) return full
    if (entry.isDirectory()) {
      const found = await findFfmpegBinary(full)
      if (found) return found
    }
  }
  return null
}

/**
 * Download a GPU-enabled ffmpeg build (BtbN GPL static build, ~40 MB) into
 * userData and re-probe NVENC. Returns the refreshed status.
 */
export async function downloadGpuFfmpeg(
  onProgress: (p: ImportProgress) => void
): Promise<GpuEncoderStatus> {
  const url = DOWNLOAD_URLS[process.platform]
  if (!url) throw new Error('GPU ffmpeg builds are not available for this platform.')

  const binDir = join(userDataDir(), 'bin')
  await mkdir(binDir, { recursive: true })
  const archivePath = join(tmpdir(), `clipforge-ffmpeg-gpu${url.endsWith('.zip') ? '.zip' : '.tar.xz'}`)
  const extractDir = join(tmpdir(), 'clipforge-ffmpeg-gpu-extract')
  await rm(extractDir, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })

  onProgress({ progress: 0, message: 'Downloading GPU-enabled ffmpeg…' })
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`Could not download ffmpeg build (HTTP ${res.status}).`)
  }
  const total = Number(res.headers.get('content-length') ?? 0)
  let seen = 0
  async function* withProgress(source: AsyncIterable<Buffer>): AsyncIterable<Buffer> {
    for await (const chunk of source) {
      seen += chunk.length
      if (total > 0) {
        onProgress({
          progress: (seen / total) * 0.85,
          message: 'Downloading GPU-enabled ffmpeg…'
        })
      }
      yield chunk
    }
  }
  await pipeline(Readable.fromWeb(res.body as WebReadableStream), withProgress, createWriteStream(archivePath))

  onProgress({ progress: 0.88, message: 'Extracting…' })
  // GNU tar handles .tar.xz on Linux; Windows 10+ bsdtar handles both zip and tar.
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xf', archivePath, '-C', extractDir], { windowsHide: true })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Archive extraction failed (tar exited ${code})`))
    )
  })

  const extracted = await findFfmpegBinary(extractDir)
  if (!extracted) throw new Error('The downloaded archive did not contain an ffmpeg binary.')
  await rm(gpuFfmpegPath(), { force: true })
  await rename(extracted, gpuFfmpegPath())
  await chmod(gpuFfmpegPath(), 0o755)
  await rm(archivePath, { force: true }).catch(() => undefined)
  await rm(extractDir, { recursive: true, force: true }).catch(() => undefined)

  onProgress({ progress: 0.96, message: 'Verifying GPU encoder…' })
  invalidateEncoderCache()
  const status = await getGpuStatus()
  onProgress({ progress: 1, message: 'Done' })
  return status
}
