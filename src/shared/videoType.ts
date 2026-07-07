import type { ClipContentType, ClipEditState, FocusKeyframe, VideoType } from './types'
import { editDefaultsForContentType } from './contentType'

export interface VideoTypeOption {
  value: VideoType
  label: string
  hint: string
}

export const VIDEO_TYPE_OPTIONS: VideoTypeOption[] = [
  {
    value: 'auto',
    label: 'Auto-detect',
    hint: 'Let ClipForge decide per clip'
  },
  {
    value: 'talking-head',
    label: 'Talking head',
    hint: 'One person to camera'
  },
  {
    value: 'podcast',
    label: 'Podcast',
    hint: 'Studio or remote conversation'
  },
  {
    value: 'webinar',
    label: 'Webinar',
    hint: 'Slides, faces and screen share'
  },
  {
    value: 'product-demo',
    label: 'Product demo',
    hint: 'Screen recording or walkthrough'
  }
]

/** Whether the pipeline should run per-clip face tracking for this video type. */
export function shouldAnalyzeFaces(videoType: VideoType): boolean {
  return videoType !== 'product-demo'
}

/** Merge auto-detected clip content with the user's video-type choice. */
export function resolveContentType(videoType: VideoType, detected: ClipContentType): ClipContentType {
  switch (videoType) {
    case 'product-demo':
      return 'screencast'
    case 'talking-head':
      return 'speaker'
    case 'podcast':
    case 'webinar':
    case 'auto':
      return detected
    default: {
      const exhaustive: never = videoType
      return exhaustive
    }
  }
}

/** Default clip edit settings when highlights are first created. */
export function initialClipEditForVideoType(videoType: VideoType): Partial<ClipEditState> {
  switch (videoType) {
    case 'product-demo':
      return {
        reframeMode: 'fit-letterbox',
        framing: 'manual',
        focusX: 0.5,
        autoZoom: false
      }
    case 'webinar':
      return {
        reframeMode: 'crop',
        framing: 'manual',
        focusX: 0.5,
        autoZoom: false
      }
    case 'talking-head':
    case 'podcast':
      return {
        reframeMode: 'crop',
        framing: 'manual',
        focusX: 0.5,
        autoZoom: true
      }
    case 'auto':
      return {
        reframeMode: 'crop',
        framing: 'manual',
        focusX: 0.5,
        autoZoom: true
      }
    default: {
      const exhaustive: never = videoType
      return exhaustive
    }
  }
}

/** Apply layout defaults after face analysis, honouring the project video type. */
export function applyVideoTypeLayout(
  edit: ClipEditState,
  contentType: ClipContentType,
  videoType: VideoType,
  focusTrack: FocusKeyframe[] | null
): ClipEditState {
  const resolved = resolveContentType(videoType, contentType)
  if (resolved === 'screencast') {
    return editDefaultsForContentType(edit, 'screencast')
  }
  const next = { ...edit, reframeMode: 'crop' as const }
  if (focusTrack) {
    return {
      ...next,
      framing: 'auto',
      focusX: focusTrack[0]?.x ?? 0.5
    }
  }
  if (videoType === 'talking-head' || videoType === 'podcast') {
    return {
      ...next,
      framing: 'manual',
      focusX: 0.5,
      autoZoom: videoType === 'talking-head' || videoType === 'podcast'
    }
  }
  return next
}
