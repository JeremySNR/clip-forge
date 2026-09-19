import type { ContentRegion } from './types'

export function validContentRegion(region: ContentRegion | undefined, overview = false): region is ContentRegion {
  return Boolean(region && [region.x, region.y, region.width, region.height].every(Number.isFinite) &&
    region.x >= 0 && region.y >= 0 && region.width >= .2 && region.height >= .2 &&
    region.x + region.width <= 1.000001 && region.y + region.height <= 1.000001 &&
    region.width * region.height >= (overview ? .04 : .12))
}

/** Expand outside the requested region to even source pixels, retaining its boundary. */
export function contentRegionPixels(region: ContentRegion, width: number, height: number): ContentRegion {
  const x = Math.floor(region.x * width / 2) * 2
  const y = Math.floor(region.y * height / 2) * 2
  const right = Math.min(Math.floor(width / 2) * 2, Math.ceil((region.x + region.width) * width / 2) * 2)
  const bottom = Math.min(Math.floor(height / 2) * 2, Math.ceil((region.y + region.height) * height / 2) * 2)
  return { x, y, width: right - x, height: bottom - y }
}

/** Convert grounded 0–1000 image coordinates, keeping a small safety margin. */
export function proposedContentRegion(box: { left: number; top: number; right: number; bottom: number } | undefined, overview = false): ContentRegion | undefined {
  if (!box || !Object.values(box).every(Number.isFinite) || box.left < 0 || box.top < 0 ||
    box.right > 1000 || box.bottom > 1000 || box.right <= box.left || box.bottom <= box.top) return undefined
  const x = Math.max(0, box.left / 1000 - .015), y = Math.max(0, box.top / 1000 - .015)
  const right = Math.min(1, box.right / 1000 + .015), bottom = Math.min(1, box.bottom / 1000 + .015)
  const region = { x, y, width: right - x, height: bottom - y }
  // Tiny changes provide no useful enlargement and can create distracting switches.
  return validContentRegion(region, overview) && region.width * region.height < .88 ? region : undefined
}

/** Shared panel dimensions; captions occupy the gap between overview and detail. */
export function detailPanelGeometry(height: number): { overviewHeight: number; detailTop: number; detailHeight: number } {
  const even = (fraction: number): number => Math.max(2, Math.floor(height * fraction / 2) * 2)
  return { overviewHeight: even(.3), detailTop: even(.46), detailHeight: even(.46) }
}

export const DETAIL_CAPTION_Y = .38
/** Provisional usefulness floor, not a guarantee of readable text. */
export const MIN_DETAIL_GAIN = 1.8
export function detailEnlargement(region: ContentRegion, sourceWidth: number, sourceHeight: number): number {
  if (!validContentRegion(region, true) || Math.min(sourceWidth, sourceHeight) <= 0) return 0
  const p = contentRegionPixels(region, sourceWidth, sourceHeight)
  const before = Math.min(360 / sourceWidth, 640 / sourceHeight)
  return Math.min(360 / p.width, detailPanelGeometry(640).detailHeight / p.height) / before
}
export interface CaptionPositionRange { start: number; end: number; positionY: number }
export function captionPositionAt(ranges: CaptionPositionRange[] | undefined, time: number, fallback: number): number {
  return ranges?.find(r => time >= r.start && time < r.end)?.positionY ?? fallback
}
