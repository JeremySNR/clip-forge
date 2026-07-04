import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { app } from 'electron'
import type { ImportProgress } from '@shared/types'
import { FFMPEG_PATH } from './ffmpeg'

/**
 * yt-dlp integration for URL imports. The standalone binary (~30 MB per
 * platform) is downloaded from the official GitHub releases into userData on
 * first use rather than bundled with the app.
 */

type ProgressFn = (p: ImportProgress) => void

function binaryName(): string {
  switch (process.platform) {
    case 'win32':
      return 'yt-dlp.exe'
    case 'darwin':
      return 'yt-dlp_macos'
    default:
      return 'yt-dlp_linux'
  }
}

function binaryDir(): string {
  const base = app?.getPath?.('userData') ?? join(process.cwd(), '.tmp', 'userData')
  return join(base, 'bin')
}

export function ytDlpPath(): string {
  return join(binaryDir(), binaryName())
}

export async function ensureYtDlp(onProgress: ProgressFn): Promise<string> {
  const binPath = ytDlpPath()
  if (existsSync(binPath)) return binPath

  onProgress({ progress: -1, message: 'Downloading yt-dlp (one-time setup)…' })
  await mkdir(binaryDir(), { recursive: true })
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binaryName()}`
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`Could not download yt-dlp (HTTP ${res.status}). Check your connection.`)
  }
  const total = Number(res.headers.get('content-length') ?? 0)
  const tmpPath = `${binPath}.download`
  let seen = 0
  async function* withProgress(source: AsyncIterable<Buffer>): AsyncIterable<Buffer> {
    for await (const chunk of source) {
      seen += chunk.length
      if (total > 0) {
        onProgress({
          progress: Math.min(1, seen / total) * 0.15,
          message: 'Downloading yt-dlp (one-time setup)…'
        })
      }
      yield chunk
    }
  }
  await pipeline(
    Readable.fromWeb(res.body as WebReadableStream),
    withProgress,
    createWriteStream(tmpPath)
  )
  await chmod(tmpPath, 0o755)
  await rename(tmpPath, binPath)
  return binPath
}

export interface UrlVideoMeta {
  id: string
  title: string
  durationSec: number
  webpageUrl: string
}

function runYtDlp(
  binPath: string,
  args: string[],
  onLine?: (line: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binPath, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let lineBuf = ''
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString()
      stdout += text
      if (onLine) {
        lineBuf += text
        const lines = lineBuf.split('\n')
        lineBuf = lines.pop() ?? ''
        for (const line of lines) onLine(line)
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 65536) stderr = stderr.slice(-32768)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(cleanYtDlpError(stderr) || `yt-dlp exited with code ${code}`))
    })
  })
}

function cleanYtDlpError(stderr: string): string {
  const line = stderr
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('ERROR:'))
  return line ? line.replace(/^ERROR:\s*(\[[^\]]+\]\s*[^\s:]*:?\s*)?/, '').trim() : ''
}

export async function fetchUrlMeta(binPath: string, url: string): Promise<UrlVideoMeta> {
  const out = await runYtDlp(binPath, ['-J', '--no-playlist', '--no-warnings', url])
  const data = JSON.parse(out) as {
    id?: string
    title?: string
    duration?: number
    webpage_url?: string
  }
  if (!data.duration || data.duration <= 0) {
    throw new Error('This URL does not point to a downloadable video.')
  }
  return {
    id: data.id ?? 'video',
    title: data.title ?? 'Imported video',
    durationSec: data.duration,
    webpageUrl: data.webpage_url ?? url
  }
}

const DOWNLOAD_FORMAT = 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b'

export async function downloadUrlVideo(
  binPath: string,
  url: string,
  outPath: string,
  onProgress: ProgressFn
): Promise<void> {
  await runYtDlp(
    binPath,
    [
      '-f', DOWNLOAD_FORMAT,
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', FFMPEG_PATH,
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '-o', outPath,
      url
    ],
    (line) => {
      const match = line.match(/\[download\]\s+([\d.]+)%/)
      if (match) {
        // Map download to 0.15..0.95 of the import (after binary setup).
        const fraction = Number(match[1]) / 100
        onProgress({ progress: 0.15 + fraction * 0.8, message: 'Downloading video…' })
      } else if (line.includes('[Merger]')) {
        onProgress({ progress: 0.96, message: 'Merging streams…' })
      }
    }
  )
}
