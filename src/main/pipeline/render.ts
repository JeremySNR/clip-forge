import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type {
  AspectRatio,
  BrandingSettings,
  Clip,
  FocusKeyframe,
  QualityPreference,
  Transcript,
  VideoInfo,
  WatermarkPosition
} from '@shared/types'
import type { EncoderPreference } from '@shared/types'
import { computeKeptSegments, remapTranscript, TimeMap, type KeptSegment } from '@shared/tighten'
import { focusPanDuration, focusSnaps } from '@shared/focusTrack'
import { computeZoomEvents, remapZoomEvents, type ZoomEvent } from '@shared/zoom'
import { runFfmpegWith } from './ffmpeg'
import { buildAss, fontsDir } from './captions'
import { audioArgs, encoderArgs, resolveEncoder } from './encoders'

/** Social platforms normalise to ~-14 LUFS; master exports to match. */
const LOUDNORM = 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000'

/**
 * Gentle audio fade at the clip tail so endings never cut off abruptly —
 * short enough to stay inside the post-roll padding after the last word.
 */
const END_FADE_SEC = 0.4

function audioChain(clipDuration: number): string {
  if (clipDuration <= END_FADE_SEC * 3) return LOUDNORM
  const st = (clipDuration - END_FADE_SEC).toFixed(3)
  return `${LOUDNORM},afade=t=out:st=${st}:d=${END_FADE_SEC}`
}

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
 * auto framing becomes a piecewise expression over t (clip-relative) that
 * mirrors focusAt: hard snaps at camera cuts / speaker switches, short eased
 * pans for within-shot moves of the same person. (Hard-stepping the crop on
 * every refocus of a moving speaker read as camera shake, magnified further
 * whenever the auto zoom was pushed in.)
 */
function focusExpression(clip: Clip): string {
  const track = clip.focusTrack
  if (clip.edit.framing !== 'auto' || !track || track.length === 0) {
    return Math.max(0, Math.min(1, clip.edit.focusX)).toFixed(4)
  }
  // Keyframes are in source time; renders seek with -ss so t starts at 0.
  const steps: FocusKeyframe[] = track.map((kf) => ({
    ...kf,
    t: kf.t - clip.edit.start,
    x: Math.max(0, Math.min(1, kf.x))
  }))
  // Collapse keyframes at/before the clip start into a single base value.
  while (steps.length > 1 && steps[1].t <= 0) steps.shift()

  const value = (i: number): string => {
    const kf = steps[i]
    if (i === 0 || focusSnaps(steps, i)) return kf.x.toFixed(4)
    // Smoothstep pan p*p*(3-2p) over the pan window, same curve as focusAt.
    const prev = steps[i - 1].x
    const dur = focusPanDuration(steps, i)
    const p = `min(1,max(0,(t-${kf.t.toFixed(3)})/${dur.toFixed(3)}))`
    return `(${prev.toFixed(4)}+${(kf.x - prev).toFixed(4)}*${p}*${p}*(3-2*${p}))`
  }
  let expr = value(steps.length - 1)
  for (let i = steps.length - 2; i >= 0; i--) {
    expr = `if(lt(t,${Math.max(0, steps[i + 1].t).toFixed(3)}),${value(i)},${expr})`
  }
  return expr
}

/** Maps `[inputLabel]` to [reframed] according to the clip's aspect/reframe settings. */
function reframeGraph(clip: Clip, source: VideoInfo, inputLabel: string): string {
  const { w, h } = targetDims(clip.edit.aspect, source)
  const ratio = (w / h).toFixed(6)
  const focus = focusExpression(clip)

  if (clip.edit.aspect === 'original') {
    return `[${inputLabel}]scale=${w}:${h}:flags=lanczos[reframed]`
  }
  if (clip.edit.reframeMode === 'fit-blur') {
    // Blurred, darkened cover background with the full frame fitted on top.
    return (
      `[${inputLabel}]split=2[bg][fg];` +
      `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=24,eq=brightness=-0.12[bgb];` +
      `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2[reframed]`
    )
  }
  // Crop to the target ratio around the horizontal focus point, then scale.
  return (
    `[${inputLabel}]crop=w='min(iw,floor(ih*${ratio}/2)*2)':h='min(ih,floor(iw/${ratio}/2)*2)':x='(iw-ow)*${focus}':y='(ih-oh)/2',` +
    `scale=${w}:${h}:flags=lanczos[reframed]`
  )
}

/**
 * Trim+concat prefix for tightened clips: cuts the kept segments out of the
 * (already -ss seeked, so clip-relative) input and concatenates them.
 * Produces [vcat] and, when audio is present, [acat].
 */
function tightenGraph(segments: KeptSegment[], clipStart: number, hasAudio: boolean): string {
  const parts: string[] = []
  const vLabels: string[] = []
  const aLabels: string[] = []
  segments.forEach((seg, i) => {
    const s = Math.max(0, seg.start - clipStart).toFixed(3)
    const e = Math.max(0, seg.end - clipStart).toFixed(3)
    parts.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[vs${i}]`)
    vLabels.push(`[vs${i}]`)
    if (hasAudio) {
      parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[as${i}]`)
      aLabels.push(`[as${i}]`)
    }
  })
  parts.push(`${vLabels.join('')}concat=n=${segments.length}:v=1:a=0[vcat]`)
  if (hasAudio) parts.push(`${aLabels.join('')}concat=n=${segments.length}:v=0:a=1[acat]`)
  return parts.join(';')
}

const BROLL_FADE_SEC = 0.25

function fmtZ(v: number): string {
  return v.toFixed(4)
}

/**
 * Piecewise zoom factor z(t) as an ffmpeg expression. Events are
 * clip-relative and sorted; between events the level holds at the previous
 * event's target. `in` is the input frame index, so t = in/fps.
 */
export function zoomExpression(events: ZoomEvent[], fps: number): string {
  const T = `(in/${fps.toFixed(3)})`
  const ramp = (e: ZoomEvent): string => {
    if (e.end - e.start < 0.01) return fmtZ(e.to)
    const p = `min(1,max(0,(${T}-${e.start.toFixed(3)})/${(e.end - e.start).toFixed(3)}))`
    // Punches ease out; creeps and anything else stay linear.
    const eased = e.style === 'punch' ? `(${p}*(2-${p}))` : p
    return `(${fmtZ(e.from)}+${fmtZ(e.to - e.from)}*${eased})`
  }
  // For t >= last event start: ramp then hold its target.
  const last = events[events.length - 1]
  let expr =
    last.end - last.start < 0.01
      ? fmtZ(last.to)
      : `if(lt(${T},${last.end.toFixed(3)}),${ramp(last)},${fmtZ(last.to)})`
  for (let i = events.length - 2; i >= 0; i--) {
    const e = events[i]
    const within =
      e.end - e.start < 0.01
        ? fmtZ(e.to)
        : `if(lt(${T},${e.end.toFixed(3)}),${ramp(e)},${fmtZ(e.to)})`
    expr = `if(lt(${T},${events[i + 1].start.toFixed(3)}),${within},${expr})`
  }
  return `if(lt(${T},${events[0].start.toFixed(3)}),1,${expr})`
}

/**
 * Maps [reframed] to [zoomed]: per-frame zoom via the perspective filter,
 * which samples the source window with subpixel (cubic) interpolation. The
 * previous zoompan-based stage rounded the crop window to whole pixels every
 * frame, which turned the slow creep ramps into visible shake.
 *
 * The window is centred horizontally and anchored slightly above middle
 * (42% from the top), where faces sit in vertical framing.
 */
function zoomGraph(events: ZoomEvent[], fps: number): string {
  const safeFps = fps > 1 && fps < 240 ? fps : 30
  const z = `(${zoomExpression(events, safeFps)})`
  const left = `(W-W/${z})/2`
  const right = `W-(W-W/${z})/2`
  const top = `(H-H/${z})*0.42`
  const bottom = `H-(H-H/${z})*0.58`
  return (
    `[reframed]perspective=` +
    `x0='${left}':y0='${top}':x1='${right}':y1='${top}':` +
    `x2='${left}':y2='${bottom}':x3='${right}':y3='${bottom}':` +
    `interpolation=cubic:eval=frame[zoomed]`
  )
}

/** Watermark corner margin as a fraction of the output width. */
const WATERMARK_MARGIN = 0.03

function watermarkOverlayXY(position: WatermarkPosition, margin: number): string {
  switch (position) {
    case 'top-left':
      return `${margin}:${margin}`
    case 'top-right':
      return `W-w-${margin}:${margin}`
    case 'bottom-left':
      return `${margin}:H-h-${margin}`
    case 'bottom-right':
      return `W-w-${margin}:H-h-${margin}`
    default: {
      const exhaustive: never = position
      return exhaustive
    }
  }
}

interface FilterGraph {
  filterComplex: string
  /** Extra `-i` input args for the B-roll images (after the main input). */
  extraInputs: string[]
  /** Label of the final audio stream, or null when the source has no audio. */
  audioLabel: string | null
}

/**
 * Full filter graph: optional tighten trim+concat -> reframe -> timed B-roll
 * image overlays (fade in/out) -> branding watermark -> caption burn-in on
 * top, plus the loudness-normalised audio chain with an end fade-out.
 * Exported for tests.
 */
export function buildFilterGraph(
  clip: Clip,
  source: VideoInfo,
  assPath: string | null,
  clipDuration: number,
  tighten: { segments: KeptSegment[]; clipStart: number } | null,
  options?: {
    branding?: BrandingSettings | null
    fontsDirPath?: string
    /** Clip-relative auto-zoom plan; null/empty disables the zoom stage. */
    zoomEvents?: ZoomEvent[] | null
  }
): FilterGraph {
  const { w, h } = targetDims(clip.edit.aspect, source)
  const parts: string[] = []
  const extraInputs: string[] = []

  let audioLabel: string | null = null
  if (tighten) {
    parts.push(tightenGraph(tighten.segments, tighten.clipStart, source.hasAudio))
    parts.push(reframeGraph(clip, source, 'vcat'))
    if (source.hasAudio) {
      parts.push(`[acat]${audioChain(clipDuration)}[aout]`)
      audioLabel = 'aout'
    }
  } else {
    parts.push(reframeGraph(clip, source, '0:v'))
    if (source.hasAudio) {
      parts.push(`[0:a]${audioChain(clipDuration)}[aout]`)
      audioLabel = 'aout'
    }
  }

  const zoomEvents = options?.zoomEvents
  let current = 'reframed'
  if (zoomEvents && zoomEvents.length > 0) {
    parts.push(zoomGraph(zoomEvents, source.fps))
    current = 'zoomed'
  }
  const initial = current

  const items = clip.broll.filter(
    (b) =>
      b.enabled &&
      b.imagePath !== null &&
      b.end > clip.edit.start &&
      b.start < clip.edit.end
  )
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

  const branding = options?.branding
  if (branding?.enabled && branding.imagePath) {
    const input = items.length + 1
    extraInputs.push('-loop', '1', '-t', clipDuration.toFixed(3), '-i', branding.imagePath)
    const wmWidth = Math.max(2, Math.round(w * Math.min(0.5, Math.max(0.04, branding.scale))))
    const opacity = Math.min(1, Math.max(0.05, branding.opacity))
    const margin = Math.round(w * WATERMARK_MARGIN)
    parts.push(
      `[${input}:v]format=rgba,scale=${wmWidth}:-1:flags=lanczos,colorchannelmixer=aa=${opacity.toFixed(3)}[wm]`
    )
    parts.push(
      `[${current}][wm]overlay=${watermarkOverlayXY(branding.position, margin)}[wmk]`
    )
    current = 'wmk'
  }

  if (assPath) {
    const fontsDirPath = options?.fontsDirPath ?? fontsDir()
    parts.push(
      `[${current}]ass=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(fontsDirPath)}'[vout]`
    )
  } else if (current === initial) {
    parts.push(`[${current}]null[vout]`)
  } else {
    // Rename the last overlay output to [vout].
    const last = parts.pop()!
    parts.push(last.replace(`[${current}]`, '[vout]'))
  }

  return { filterComplex: parts.join(';'), extraInputs, audioLabel }
}

export interface RenderJob {
  clip: Clip
  source: VideoInfo
  transcript: Transcript | null
  outputPath: string
  encoder?: EncoderPreference
  quality?: QualityPreference
  /** App-wide watermark/logo composited under the captions. */
  branding?: BrandingSettings | null
  /** Directory libass loads fonts from; defaults to the bundled fonts. */
  fontsDirPath?: string
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export async function renderClip(job: RenderJob): Promise<string> {
  const { clip, source, transcript } = job
  const quality = job.quality ?? 'standard'
  const start = clip.edit.start
  const duration = Math.max(0.5, clip.edit.end - clip.edit.start)
  const { w, h } = targetDims(clip.edit.aspect, source)

  // Tighten cuts: figure out the kept segments and remap everything that is
  // timed against the source (captions, B-roll, face track) into the
  // compacted output timeline.
  const segments =
    clip.edit.tightenCuts && transcript
      ? computeKeptSegments(transcript, start, clip.edit.end)
      : null
  const map = segments ? new TimeMap(segments) : null
  const outputDuration = map ? map.outputDuration : duration

  let effectiveClip = clip
  let captionTranscript = transcript
  let captionStart = start
  let captionEnd = clip.edit.end
  if (map && segments) {
    effectiveClip = {
      ...clip,
      edit: { ...clip.edit, start: 0, end: outputDuration },
      broll: clip.broll
        .map((b) => ({ ...b, start: map.toOutput(b.start), end: map.toOutput(b.end) }))
        .filter((b) => b.end - b.start > 0.6),
      focusTrack: clip.focusTrack
        ? clip.focusTrack.map((kf) => ({ ...kf, t: map.toOutput(kf.t) }))
        : null
    }
    if (transcript) {
      captionTranscript = remapTranscript(transcript, map, start, clip.edit.end)
      captionStart = 0
      captionEnd = outputDuration
    }
  }

  let assPath: string | null = null
  if (clip.edit.captionsEnabled && captionTranscript) {
    const ass = buildAss(captionTranscript, {
      styleId: clip.edit.captionStyleId,
      width: w,
      height: h,
      clipStart: captionStart,
      clipEnd: captionEnd,
      title: clip.edit.showTitle ? clip.hook || clip.title : undefined,
      fontFamily: clip.edit.captionFontFamily ?? undefined
    })
    const dir = join(tmpdir(), 'clipforge')
    await mkdir(dir, { recursive: true })
    assPath = join(dir, `captions-${randomUUID()}.ass`)
    await writeFile(assPath, ass, 'utf8')
  }

  // Auto zoom: plan in source time (shared with the preview), then remap to
  // the clip-relative output timeline the filters run on.
  let zoomEvents: ZoomEvent[] | null = null
  if (clip.edit.autoZoom) {
    const planned = computeZoomEvents(transcript, start, clip.edit.end, segments)
    zoomEvents = remapZoomEvents(planned, (t) => (map ? map.toOutput(t) : t - start))
    if (zoomEvents.length === 0) zoomEvents = null
  }

  const graph = buildFilterGraph(
    effectiveClip,
    source,
    assPath,
    outputDuration,
    segments ? { segments, clipStart: start } : null,
    { branding: job.branding, fontsDirPath: job.fontsDirPath, zoomEvents }
  )
  const buildArgs = (videoArgs: string[]): string[] => [
    '-ss', start.toFixed(3),
    '-t', duration.toFixed(3),
    '-i', source.path,
    ...graph.extraInputs,
    '-filter_complex', graph.filterComplex,
    '-map', '[vout]',
    ...(graph.audioLabel ? ['-map', `[${graph.audioLabel}]`] : []),
    ...videoArgs,
    ...audioArgs(quality),
    '-movflags', '+faststart',
    job.outputPath
  ]

  const resolved = await resolveEncoder(job.encoder ?? 'auto')
  const runOpts = {
    onProgress: (t: number) => job.onProgress?.(Math.min(1, t / outputDuration)),
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
