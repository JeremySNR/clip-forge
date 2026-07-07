import type { ClipContentType, ClipEditState } from './types'

/** Face coverage below this is treated as a screencast / demo / slides clip. */
export const SCREENCAST_FACE_COVERAGE = 0.25

export function classifyClipContent(faceCoverage: number, hasFocusTrack: boolean): ClipContentType {
  if (!hasFocusTrack || faceCoverage < SCREENCAST_FACE_COVERAGE) return 'screencast'
  return 'speaker'
}

/** Layout defaults for demos and screen shares on vertical exports. */
export function editDefaultsForContentType(
  edit: ClipEditState,
  contentType: ClipContentType
): ClipEditState {
  if (contentType !== 'screencast') return edit
  return {
    ...edit,
    reframeMode: 'fit-letterbox',
    framing: 'manual',
    focusX: 0.5,
    autoZoom: false
  }
}

/** Auto zoom only makes sense on cropped talking-head reframes. */
export function clipAllowsAutoZoom(edit: ClipEditState): boolean {
  return (edit.autoZoom ?? false) && edit.reframeMode === 'crop'
}
