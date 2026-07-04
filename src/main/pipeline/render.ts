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

/** Maps [0:v] to [reframed] according to the clip's aspect/reframe settings. */
function reframeGraph(clip: Clip, source: VideoInfo): string {
  const { w, h } = targetDims(clip.edit.aspect, source)
  const ratio = (w / h).toFixed(6)
  const focus = focusExpression(clip)

  if (clip.edit.aspect === 'original') {
    return `[0:v]scale=${w}:${h}:flags=lanczos[reframed]`
  }
  if (clip.edit.reframeMode === 'fit-blur') {
    // Blurred, darkened cover background with the full frame fitted on top.
    return (
      `[0:v]split=2[bg][fg];` +
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=24,eq=brightness=-0.12[bgb];` +
      `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2[reframed]`
    )
  }
  // Crop to the target ratio around the horizontal focus point, then scale.
  return (
    `[0:v]crop=w='min(iw,floor(ih*${ratio}/2)*2)':h='min(ih,floor(iw/${ratio}/2)*2)':x='(iw-ow)*${focus}':y='(ih-oh)/2',` +
    `scale=${w}:${h}:flags=lanczos[reframed]`
  )
}

const BROLL_FADE_SEC = 0.25

interface FilterGraph {
  filterComplex: string
  /** Extra `-i` input args for the B-roll images (after the main input). */
  extraInputs: string[]
}

/**
 * Full video filter graph: reframe -> timed B-roll image overlays (fade
 * in/out, fullscreen or picture-in-picture) -> caption burn-in on top.
 */
function buildFilterGraph(
  clip: Clip,
  source: VideoInfo,
  assPath: string | null,
  clipDuration: number
): FilterGraph {
  const { w, h } = targetDims(clip.edit.aspect, source)
  const parts: string[] = [reframeGraph(clip, source)]
  const extraInputs: string[] = []

  const items = clip.broll.filter(
    (b) =>
      b.enabled &&
      b.imagePath !== null &&
      b.end > clip.edit.start &&
      b.start < clip.edit.end
  )

  let current = 'reframed'
  items.forEach((item, i) => {
    const input = i + 1
    const s = Math.max(0, item.start - clip.edit.start)
    const e = Math.min(clipDuration, item.end - clip.edit.start)
    extraInputs.push('-loop', '1', '-t', clipDuration.toFixed(3), '-i', item.imagePath!)

    const fades =
      `format=rgba,` +
      `fade=t=in:st=${s.toFixed(3)}:d=${BROLL_FADE_SEC}:alpha=1,` +
      `fade=t=out:st=${Math.max(s, e - BROLL_FADE_SEC).toFixed(3)}:d=${BROLL_FADE_SEC}:alpha=1`

    if (item.mode === 'fullscreen') {
      parts.push(
        `[${input}:v]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},${fades}[b${i}]`
      )
      parts.push(
        `[${current}][b${i}]overlay=0:0:enable='between(t,${s.toFixed(3)},${e.toFixed(3)})':eof_action=pass[v${i}]`
      )
    } else {
      // Picture-in-picture panel over the speaker, upper-centre, white border.
      const panelW = Math.floor((w * 0.62) / 2) * 2
      parts.push(
        `[${input}:v]scale=${panelW}:-2:flags=lanczos,pad=w=iw+16:h=ih+16:x=8:y=8:color=white,${fades}[b${i}]`
      )
      parts.push(
        `[${current}][b${i}]overlay=(W-w)/2:${Math.round(h * 0.1)}:enable='between(t,${s.toFixed(3)},${e.toFixed(3)})':eof_action=pass[v${i}]`
      )
    }
    current = `v${i}`
  })

  if (assPath) {
    parts.push(`[${current}]ass=filename='${escapeFilterPath(assPath)}'[vout]`)
  } else if (current === 'reframed') {
    parts.push(`[reframed]null[vout]`)
  } else {
    // Rename the last overlay output to [vout].
    const last = parts.pop()!
    parts.push(last.replace(`[${current}]`, '[vout]'))
  }

  return { filterComplex: parts.join(';'), extraInputs }
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

  const graph = buildFilterGraph(clip, source, assPath, duration)
  const buildArgs = (videoArgs: string[]): string[] => [
    '-ss', start.toFixed(3),
    '-t', duration.toFixed(3),
    '-i', source.path,
    ...graph.extraInputs,
    '-filter_complex', graph.filterComplex,
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
