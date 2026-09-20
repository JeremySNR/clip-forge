import type { Clip, FocusKeyframe, LayoutShot } from './types'
import { contentRegionPixels, detailPanelGeometry, validContentRegion } from './contentRegion'
import type { ZoomEvent } from './zoom'
import { cropSourceWidth, faceCentreCropLeft, focusAt } from './focusTrack'
import { zoomAt } from './zoom'

/**
 * Live-preview framing math shared with the renderer. The export runs crop
 * then zoom as separate ffmpeg stages; the preview mirrors that split and
 * must sample time smoothly — video.currentTime only advances at the decode
 * frame rate while the display refreshes faster, which made slow zoom creeps
 * stutter when zoom/focus were driven from coarse time steps.
 */

/** Vertical anchor matching ffmpeg perspective zoom (42% from top). */
export const PREVIEW_ZOOM_ORIGIN_Y = 0.42

export interface PlaybackClock {
  mediaTime: number
  wallAt: number
}

export interface PreviewFramePlan {
  zoomEvents: ZoomEvent[] | null
  focusTrack: FocusKeyframe[] | null
  framing: Clip['edit']['framing']
  manualFocusX: number
  isCrop: boolean
  fitRanges?: Array<Omit<LayoutShot, 'mode'>>
}

/**
 * Extrapolate playback time between coarse video.currentTime updates so slow
 * zoom ramps advance every display frame, not just when the demuxer bumps time.
 */
export function smoothPlaybackTime(
  video: { currentTime: number; paused: boolean; seeking: boolean },
  clock: PlaybackClock,
  wallNow = performance.now()
): { t: number; clock: PlaybackClock } {
  const raw = video.currentTime
  if (video.paused || video.seeking) {
    return { t: raw, clock: { mediaTime: raw, wallAt: wallNow } }
  }
  if (clock.wallAt === 0 || Math.abs(raw - clock.mediaTime) > 0.25) {
    return { t: raw, clock: { mediaTime: raw, wallAt: wallNow } }
  }
  if (raw !== clock.mediaTime) {
    return { t: raw, clock: { mediaTime: raw, wallAt: wallNow } }
  }
  return {
    t: clock.mediaTime + (wallNow - clock.wallAt) / 1000,
    clock
  }
}

export function previewFocusX(plan: PreviewFramePlan, t: number): number {
  if (plan.framing === 'auto' && plan.focusTrack) return focusAt(plan.focusTrack, t)
  return plan.manualFocusX
}

export function previewZoom(plan: PreviewFramePlan, t: number): number {
  if (plan.fitRanges?.length) return 1
  return plan.zoomEvents ? zoomAt(plan.zoomEvents, t) : 1
}

export function previewIsCrop(plan: PreviewFramePlan, t: number): boolean {
  return plan.isCrop && !plan.fitRanges?.some((range) => t >= range.start && t < range.end)
}

/** Fit the same even-pixel source region as export, masking discarded picture areas. */
export function previewRegionStyle(
  plan: PreviewFramePlan, t: number, sourceWidth: number, sourceHeight: number,
  targetWidth: number, targetHeight: number
): { transform: string; clipPath: string } | null {
  const shot = plan.isCrop ? plan.fitRanges?.find(r => t >= r.start && t < r.end) : undefined
  const region = shot?.region
  if (!validContentRegion(region, shot?.overview) || Math.min(sourceWidth, sourceHeight, targetWidth, targetHeight) <= 0) return null
  const pixels = contentRegionPixels(region, sourceWidth, sourceHeight)
  const fullScale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const panels = shot?.overview ? detailPanelGeometry(targetHeight) : null
  const scale = Math.min(targetWidth / pixels.width, (panels?.detailHeight ?? targetHeight) / pixels.height)
  const x = (sourceWidth / 2 - pixels.x - pixels.width / 2) * scale
  const y = (sourceHeight / 2 - pixels.y - pixels.height / 2) * scale +
    (panels ? panels.detailTop + panels.detailHeight / 2 - targetHeight / 2 : 0)
  const left = (targetWidth - sourceWidth * fullScale) / 2 + pixels.x * fullScale
  const top = (targetHeight - sourceHeight * fullScale) / 2 + pixels.y * fullScale
  const right = targetWidth - left - pixels.width * fullScale
  const bottom = targetHeight - top - pixels.height * fullScale
  return { transform: `translate(${x}px,${y}px) scale(${scale / fullScale})`, clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px)` }
}

/** CSS object-position is a crop-travel fraction, not a source face centre. */
export function previewObjectPosition(
  plan: PreviewFramePlan, t: number, sourceWidth: number, sourceHeight: number,
  targetWidth: number, targetHeight: number
): number {
  const x = previewFocusX(plan, t)
  if (plan.framing !== 'auto' || !plan.focusTrack?.length) return x
  if (Math.min(sourceWidth, sourceHeight, targetWidth, targetHeight) <= 0) return 0.5
  const travel = sourceWidth - cropSourceWidth(sourceWidth, sourceHeight, targetWidth, targetHeight)
  return travel > 0 ? faceCentreCropLeft(x, sourceWidth, sourceHeight, targetWidth, targetHeight) / travel : 0.5
}
