import type { Clip, FocusKeyframe } from './types'
import type { ZoomEvent } from './zoom'
import { focusAt } from './focusTrack'
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
  return plan.zoomEvents ? zoomAt(plan.zoomEvents, t) : 1
}
