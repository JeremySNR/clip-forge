import type { FocusKeyframe } from './types'

/**
 * Focus-track sampling shared by the live preview (object-position) and the
 * export (ffmpeg crop expression, see render.ts), so both move identically.
 *
 * `FocusKeyframe.x` is the horizontal **face centre** in the source frame
 * (0 = far left, 1 = far right). The live preview passes that straight to
 * CSS `object-position` (correct for object-fit: cover). Export converts it
 * to a crop offset so the face sits in the middle of the window — see
 * `faceCentreCropX` in render.ts. Manual `focusX` is different: it is a crop
 * slider (0 = show the far left, 0.5 = frame centre, 1 = far right).
 *
 * Keyframes that land on a camera cut or speaker switch (kf.cut) snap
 * instantly — a hard reframe reads as a deliberate camera change there. But
 * keyframes produced by the *same person moving within a shot* must not snap:
 * a talking head that sways or drifts emits a refocus every few seconds, and
 * hard-stepping the crop on each one reads as constant camera shake —
 * especially with auto zoom pushed in, which magnifies every jump. Those
 * small shifts are followed with a short eased pan instead.
 */

/** Duration of the eased pan used for within-shot focus moves. */
export const FOCUS_PAN_SEC = 0.6
/**
 * Shifts larger than this (normalized frame width) snap even without a cut
 * flag: a jump that big is a speaker switch, and legacy tracks saved before
 * cut flags existed must keep their hard switches.
 */
export const FOCUS_PAN_MAX_SHIFT = 0.3

/** Smoothstep ease: gentle attack and landing, the classic camera-pan curve. */
export function focusEase(p: number): number {
  const c = Math.min(1, Math.max(0, p))
  return c * c * (3 - 2 * c)
}

/** Pan duration for the keyframe at `index`, capped so it never overruns the next keyframe. */
export function focusPanDuration(track: FocusKeyframe[], index: number): number {
  const next = track[index + 1]
  return next ? Math.min(FOCUS_PAN_SEC, Math.max(0, next.t - track[index].t)) : FOCUS_PAN_SEC
}

/** Whether the crop snaps to the keyframe at `index` instead of panning to it. */
export function focusSnaps(track: FocusKeyframe[], index: number): boolean {
  const kf = track[index]
  const prev = track[index - 1]
  if (!prev) return true
  return (
    kf.cut === true ||
    Math.abs(kf.x - prev.x) > FOCUS_PAN_MAX_SHIFT ||
    focusPanDuration(track, index) < 0.05
  )
}

/** Sample the focus track at a given source time. */
export function focusAt(track: FocusKeyframe[], t: number): number {
  let index = -1
  for (let i = 0; i < track.length; i++) {
    if (track[i].t <= t) index = i
    else break
  }
  if (index <= 0) return track[0]?.x ?? 0.5
  const kf = track[index]
  if (focusSnaps(track, index)) return kf.x
  const prev = track[index - 1]
  const p = focusEase((t - kf.t) / focusPanDuration(track, index))
  return prev.x + (kf.x - prev.x) * p
}

/**
 * Crop-window width for a source frame at a given output aspect ratio.
 * Mirrors the `min(iw,floor(ih*ratio/2)*2)` expression in render.ts.
 */
export function cropSourceWidth(sourceW: number, sourceH: number, aspectW: number, aspectH: number): number {
  const ratio = aspectW / aspectH
  return Math.min(sourceW, Math.floor((sourceH * ratio) / 2) * 2)
}

/**
 * Left edge of the crop window (source pixels) that centres on `faceX`
 * (0..1 face centre). Clamped so the window stays inside the frame.
 */
export function faceCentreCropLeft(
  faceX: number,
  sourceW: number,
  sourceH: number,
  aspectW: number,
  aspectH: number
): number {
  const ow = cropSourceWidth(sourceW, sourceH, aspectW, aspectH)
  const maxLeft = Math.max(0, sourceW - ow)
  return Math.max(0, Math.min(maxLeft, faceX * sourceW - ow / 2))
}
