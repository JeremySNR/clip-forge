import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { AspectRatio, Clip, Transcript, VideoInfo } from '@shared/types'
import { runFfmpeg } from './ffmpeg'
import { buildAss } from './captions'

function targetDims(aspect: AspectRatio, source: VideoInfo): { w: number; h: number } {
  switch (aspect) {
    case '9:16':
      return { w: 1080, h: 1920 }
    case '1:1':
      return { w: 1080, h: 1080 }
    case '16:9':
      return { w: 1920, h: 1080 }
    case 'original': {
      // Cap at 1920 on the long edge, keep even dimensions.
      const scale = Math.min(1, 1920 / Math.max(source.width, source.height))
      const w = Math.round((source.width * scale) / 2) * 2
      const h = Math.round((source.height * scale) / 2) * 2
      return { w, h }
    }
    default: {
      const exhaustive: never = aspect
      return exhaustive
    }
  }
}

/** Escape a filesystem path for use inside an ffmpeg filter argument. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function buildVideoFilter(clip: Clip, source: VideoInfo, assPath: string | null): string {
  const { w, h } = targetDims(clip.edit.aspect, source)
  const ratio = (w / h).toFixed(6)
  const focus = Math.max(0, Math.min(1, clip.edit.focusX)).toFixed(4)
  const filters: string[] = []

  if (clip.edit.aspect === 'original') {
    filters.push(`scale=${w}:${h}`)
  } else if (clip.edit.reframeMode === 'fit-blur') {
    // Blurred, darkened cover background with the full frame fitted on top.
    return (
      `split=2[bg][fg];` +
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=24,eq=brightness=-0.12[bgb];` +
      `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2` +
      (assPath ? `,ass=filename='${escapeFilterPath(assPath)}'` : '')
    )
  } else {
    // Crop to the target ratio around the horizontal focus point, then scale.
    filters.push(
      `crop=w='min(iw,floor(ih*${ratio}/2)*2)':h='min(ih,floor(iw/${ratio}/2)*2)':x='(iw-ow)*${focus}':y='(ih-oh)/2'`,
      `scale=${w}:${h}`
    )
  }

  if (assPath) filters.push(`ass=filename='${escapeFilterPath(assPath)}'`)
  return filters.join(',')
}

export interface RenderJob {
  clip: Clip
  source: VideoInfo
  transcript: Transcript | null
  outputPath: string
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export async function renderClip(job: RenderJob): Promise<string> {
  const { clip, source, transcript } = job
  const start = clip.edit.start
  const duration = Math.max(0.5, clip.edit.end - clip.edit.start)
  const { w, h } = targetDims(clip.edit.aspect, source)

  let assPath: string | null = null
  if (clip.edit.captionsEnabled && transcript) {
    const ass = buildAss(transcript, {
      styleId: clip.edit.captionStyleId,
      width: w,
      height: h,
      clipStart: start,
      clipEnd: clip.edit.end,
      title: clip.edit.showTitle ? clip.hook || clip.title : undefined
    })
    const dir = join(tmpdir(), 'clipforge')
    await mkdir(dir, { recursive: true })
    assPath = join(dir, `captions-${randomUUID()}.ass`)
    await writeFile(assPath, ass, 'utf8')
  }

  const vf = buildVideoFilter(clip, source, assPath)
  const args = [
    '-ss', start.toFixed(3),
    '-t', duration.toFixed(3),
    '-i', source.path,
    '-filter_complex', `[0:v]${vf}[vout]`,
    '-map', '[vout]',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    job.outputPath
  ]

  await runFfmpeg(args, {
    onProgress: (t) => job.onProgress?.(Math.min(1, t / duration)),
    signal: job.signal
  })
  return job.outputPath
}
