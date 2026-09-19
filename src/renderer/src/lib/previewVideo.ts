import type { PreviewFramePlan } from '@shared/previewFrame'
import { PREVIEW_ZOOM_ORIGIN_Y, previewObjectPosition, previewZoom, previewIsCrop, previewRegionStyle } from '@shared/previewFrame'
import { contentRegionPixels, detailPanelGeometry } from '@shared/contentRegion'

/** Apply crop focus and zoom directly to the preview DOM (bypasses React). */
export function applyPreviewVideoFrame(
  video: HTMLVideoElement,
  zoomLayer: HTMLDivElement,
  plan: PreviewFramePlan,
  t: number,
  overview?: HTMLCanvasElement | null
): void {
  const focusX = previewObjectPosition(plan, t, video.videoWidth, video.videoHeight, video.clientWidth, video.clientHeight)
  const zoom = previewZoom(plan, t)
  const isCrop = previewIsCrop(plan, t)
  video.style.objectFit = isCrop ? 'cover' : 'contain'
  video.style.objectPosition = isCrop ? `${focusX * 100}% 50%` : '50% 50%'
  const region = previewRegionStyle(plan, t, video.videoWidth, video.videoHeight, video.clientWidth, video.clientHeight)
  video.style.transform = region?.transform ?? 'none'
  video.style.clipPath = region?.clipPath ?? 'none'
  if (overview) {
    const shot = plan.isCrop ? plan.fitRanges?.find(r => t >= r.start && t < r.end && r.overview && r.region) : undefined
    overview.style.display = shot && region && video.readyState >= 2 ? 'block' : 'none'
    if (shot?.region && region && video.readyState >= 2) {
      const w = video.clientWidth, h = detailPanelGeometry(video.clientHeight).overviewHeight
      const ratio = window.devicePixelRatio || 1
      if (overview.width !== Math.round(w * ratio)) overview.width = Math.round(w * ratio)
      if (overview.height !== Math.round(h * ratio)) overview.height = Math.round(h * ratio)
      overview.style.height = `${h}px`
      const context = overview.getContext('2d')
      if (context) {
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        context.fillStyle = '#000'
        context.fillRect(0, 0, w, h)
        const scale = Math.min(w / video.videoWidth, h / video.videoHeight)
        const x = (w - video.videoWidth * scale) / 2, y = (h - video.videoHeight * scale) / 2
        context.drawImage(video, x, y, video.videoWidth * scale, video.videoHeight * scale)
        const p = contentRegionPixels(shot.region, video.videoWidth, video.videoHeight)
        const stroke = Math.max(2, Math.round(video.videoWidth / 320)) * scale
        context.strokeStyle = '#60a5fa'
        context.lineWidth = stroke
        context.strokeRect(x + p.x * scale + stroke / 2, y + p.y * scale + stroke / 2,
          p.width * scale - stroke, p.height * scale - stroke)
      }
    }
  }
  zoomLayer.style.transformOrigin = `50% ${PREVIEW_ZOOM_ORIGIN_Y * 100}%`
  zoomLayer.style.transform = zoom > 1.0001 ? `scale(${zoom}) translateZ(0)` : 'translateZ(0)'
}
