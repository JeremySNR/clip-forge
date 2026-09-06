import type { Clip, ClipEditState, VideoType } from './types'
import { initialClipEditForVideoType } from './videoType'

/**
 * Which clips get their reframe analysis during the pipeline, and how a
 * finished analysis is grafted onto a clip that may have been edited since.
 *
 * Reframe analysis (UltraFace + LR-ASD at 25 fps) is by far the slowest
 * per-clip stage: tens of seconds of CPU per clip, against a few seconds for
 * everything else. Running it for every candidate made an hour of source
 * video take most of an hour to come back, most of it spent on clips the
 * user would never open. So the pipeline analyses only the top tier and the
 * rest are analysed on demand — when the clip is opened in the editor or
 * exported (see main/pipeline/reframe.ts).
 */

/** Clips always analysed up front, however they score. */
export const EAGER_REFRAME_MIN = 8
/** Beyond the minimum, clips scoring at least this are also analysed up front… */
export const EAGER_REFRAME_SCORE = 80
/** …up to this many in total. */
export const EAGER_REFRAME_MAX = 12

/**
 * Ids of the clips the pipeline should analyse eagerly. Input is the ranked
 * list (highest score first); ties are resolved by rank. Pure and exported
 * for tests.
 */
export function selectEagerReframeIds(ranked: Clip[]): Set<string> {
  const eager = new Set<string>()
  for (const clip of ranked) {
    if (eager.size >= EAGER_REFRAME_MAX) break
    if (eager.size < EAGER_REFRAME_MIN || clip.viralityScore >= EAGER_REFRAME_SCORE) {
      eager.add(clip.id)
    }
  }
  return eager
}

/** Whether a clip still needs its reframe analysis before it is fully framed. */
export function needsReframe(clip: Clip): boolean {
  return clip.reframeStatus === 'pending'
}

/** The layout fields the reframe analysis sets defaults for. */
const LAYOUT_FIELDS = ['reframeMode', 'framing', 'focusX', 'autoZoom'] as const

/**
 * Whether a pending clip's layout is still the default it was created with
 * for this video type — i.e. the user has not chosen a layout of their own
 * while the analysis was outstanding.
 */
export function layoutUntouched(edit: ClipEditState, videoType: VideoType): boolean {
  const defaults = initialClipEditForVideoType(videoType)
  return LAYOUT_FIELDS.every((field) => (edit[field] ?? false) === (defaults[field] ?? false))
}

/**
 * Graft the result of a reframe analysis onto the current copy of a clip.
 *
 * The analysis owns the focus track and the content classification, which
 * are always taken. It also proposes layout defaults (crop vs letterbox,
 * auto vs manual framing, the starting focus, whether auto zoom makes sense)
 * — those are applied only while the clip still has the layout it was
 * created with; a user who picked letterbox or dragged the focus slider
 * while waiting keeps their choice. Everything else — title, trim, caption
 * style, B-roll, the social caption — belongs to whoever has been editing
 * the clip and is kept from `current`. Used on both sides of the IPC
 * boundary so the renderer's local state and the saved project converge on
 * the same clip.
 */
export function mergeReframeResult(current: Clip, analysed: Clip, videoType: VideoType): Clip {
  const merged: Clip = {
    ...current,
    focusTrack: analysed.focusTrack,
    contentType: analysed.contentType,
    reframeStatus: 'done'
  }
  if (!layoutUntouched(current.edit, videoType)) return merged
  return {
    ...merged,
    edit: {
      ...current.edit,
      reframeMode: analysed.edit.reframeMode,
      framing: analysed.edit.framing,
      focusX: analysed.edit.focusX,
      autoZoom: analysed.edit.autoZoom
    }
  }
}
