import type { PreviewFramePlan } from '@shared/previewFrame'
import { PREVIEW_ZOOM_ORIGIN_Y, previewFocusX, previewZoom } from '@shared/previewFrame'

/** Apply crop focus and zoom directly to the preview DOM (bypasses React). */
export function applyPreviewVideoFrame(
  video: HTMLVideoElement,
  zoomLayer: HTMLDivElement,
  plan: PreviewFramePlan,
  t: number
): void {
  const focusX = previewFocusX(plan, t)
  const zoom = previewZoom(plan, t)
  video.style.objectPosition = plan.isCrop ? `${focusX * 100}% 50%` : '50% 50%'
  zoomLayer.style.transformOrigin = `50% ${PREVIEW_ZOOM_ORIGIN_Y * 100}%`
  zoomLayer.style.transform = zoom > 1.0001 ? `scale(${zoom}) translateZ(0)` : 'translateZ(0)'
}
