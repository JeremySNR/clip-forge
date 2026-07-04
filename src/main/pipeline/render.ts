import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { AspectRatio, Clip, QualityPreference, Transcript, VideoInfo } from '@shared/types'
import type { EncoderPreference } from '@shared/types'
import { runFfmpegWith } from './ffmpeg'
import { buildAss } from './captions'
import { audioArgs, encoderArgs, resolveEncoder } from './encoders'

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

/**
 * Build the crop x-position expression. Manual framing is a constant focus;
 * auto framing becomes a piecewise-constant expression over t (clip-relative)
 * so the crop hard-cuts between speaker positions like a camera switch.
 */
function focusExpression(clip: Clip): string {
  const track = clip.focusTrack
  if (clip.edit.framing !== 'auto' || !track || track.length === 0) {
    return Math.max(0, Math.min(1, clip.edit.focusX)).toFixed(4)
  }
  // Keyframes are in source time; renders seek with -ss so t starts at 0.
  const steps = track
    .map((kf) => ({ t: kf.t - clip.edit.start, x: Math.max(0, Math.min(1, kf.x)) }))
    .filter((kf, i) => i === 0 || kf.t > 0)
  if (steps.length === 0) return '0.5'
  let expr = steps[steps.length - 1].x.toFixed(4)
  for (let i = steps.length - 2; i >= 0; i--) {
    expr = `if(lt(t,${Math.max(0, steps[i + 1].t).toFixed(3)}),${steps[i].x.toFixed(4)},${expr})`
  }
  return expr
}

function buildVideoFilter(clip: Clip, source: VideoInfo, assPath: string | null): string {
  const { w, h } = targetDims(clip.edit.aspect, source)
  const ratio = (w / h).toFixed(6)
  const focus = focusExpression(clip)
  const filters: string[] = []

  if (clip.edit.aspect === 'original') {
    filters.push(`scale=${w}:${h}:flags=lanczos`)
  } else if (clip.edit.reframeMode === 'fit-blur') {
    // Blurred, darkened cover background with the full frame fitted on top.
    return (
      `split=2[bg][fg];` +
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=24,eq=brightness=-0.12[bgb];` +
      `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2` +
      (assPath ? `,ass=filename='${escapeFilterPath(assPath)}'` : '')
    )
  } else {
    // Crop to the target ratio around the horizontal focus point, then scale.
    filters.push(
      `crop=w='min(iw,floor(ih*${ratio}/2)*2)':h='min(ih,floor(iw/${ratio}/2)*2)':x='(iw-ow)*${focus}':y='(ih-oh)/2'`,
      `scale=${w}:${h}:flags=lanczos`
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
  encoder?: EncoderPreference
  quality?: QualityPreference
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export async function renderClip(job: RenderJob): Promise<string> {
  const { clip, source, transcript } = job
  const quality = job.quality ?? 'standard'
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
  const buildArgs = (videoArgs: string[]): string[] => [
    '-ss', start.toFixed(3),
    '-t', duration.toFixed(3),
    '-i', source.path,
    '-filter_complex', `[0:v]${vf}[vout]`,
    '-map', '[vout]',
    '-map', '0:a?',
    ...videoArgs,
    ...audioArgs(quality),
    '-movflags', '+faststart',
    job.outputPath
  ]

  const resolved = await resolveEncoder(job.encoder ?? 'auto')
  const runOpts = {
    onProgress: (t: number) => job.onProgress?.(Math.min(1, t / duration)),
    signal: job.signal
  }

  try {
    await runFfmpegWith(resolved.bin, buildArgs(encoderArgs(resolved.kind, quality)), runOpts)
  } catch (err) {
    // NVENC can fail at runtime (driver updates, GPU busy, session limits).
    // Unless the user explicitly demanded GPU, fall back to a CPU encode.
    if (resolved.kind === 'nvenc' && job.encoder !== 'gpu' && !job.signal?.aborted) {
      console.error('NVENC render failed, retrying on CPU:', err)
      await rm(job.outputPath, { force: true }).catch(() => undefined)
      await runFfmpegWith(resolved.bin, buildArgs(encoderArgs('cpu', quality)), runOpts)
    } else {
      throw err
    }
  }
  return job.outputPath
}
