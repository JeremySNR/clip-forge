import { DEFAULT_CAPTION_STYLE_ID } from './captionStyles'
import { editDefaultsForContentType } from './contentType'
import type {
  AspectRatio,
  Clip,
  ClipContentType,
  ClipEditState,
  FocusKeyframe,
  Project
} from './types'

/**
 * "Caption whole video" mode: rather than letting the AI cut highlights out
 * of the source, the whole video becomes a single clip that is transcribed,
 * reframed vertical and captioned.
 *
 * The editor, the live preview and the renderer are all clip-driven, so the
 * mode is modelled as one full-length clip marked `origin: 'whole-video'`
 * instead of a parallel code path. Everything those screens already do —
 * trim, reframe, caption styling, auto zoom, export — works on it unchanged.
 */

/** The project's full-video clip, or null when it has none. */
export function findWholeVideoClip(project: Project): Clip | null {
  return project.clips.find(isWholeVideoClip) ?? null
}

export function isWholeVideoClip(clip: Clip): boolean {
  return clip.origin === 'whole-video'
}

/** AI-found clips only — what the clip grid lists and "Export all" exports. */
export function highlightClips(project: Project): Clip[] {
  return project.clips.filter((c) => !isWholeVideoClip(c))
}

export interface WholeVideoEditOptions {
  aspect: AspectRatio
  autoZoom: boolean
  durationSec: number
  /** Speaker track across the video, or null when tracking was skipped. */
  focusTrack: FocusKeyframe[] | null
  contentType: ClipContentType
  /** Caption look to keep; defaults to the standard preset. */
  captionStyleId?: string
  captionFontFamily?: string | null
}

/**
 * Edit defaults for a full-video clip: the whole duration, captions on, and a
 * crop that follows the speaker when a track was built.
 *
 * Tighten cuts stays off. Over a 90-second highlight it drops a handful of
 * pauses; across a whole video it would cut the timeline into hundreds of
 * segments — a far heavier render, and rarely what "caption this video"
 * means. It is still one toggle away in the editor.
 */
export function wholeVideoEdit(opts: WholeVideoEditOptions): ClipEditState {
  const edit: ClipEditState = {
    aspect: opts.aspect,
    reframeMode: 'crop',
    framing: opts.focusTrack ? 'auto' : 'manual',
    tightenCuts: false,
    autoZoom: opts.autoZoom,
    // Auto framing seeds from the track's first face centre; manual is the
    // middle of the frame (the two mean different things — see focusTrack.ts).
    focusX: opts.focusTrack?.[0]?.x ?? 0.5,
    captionsEnabled: true,
    captionStyleId: opts.captionStyleId ?? DEFAULT_CAPTION_STYLE_ID,
    captionFontFamily: opts.captionFontFamily ?? null,
    showTitle: false,
    start: 0,
    end: opts.durationSec
  }
  // A screen recording cropped to 9:16 loses most of the frame: letterbox it.
  return editDefaultsForContentType(edit, opts.contentType)
}
