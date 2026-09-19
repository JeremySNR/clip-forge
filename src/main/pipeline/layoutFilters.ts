import type { ContentRegion } from '@shared/types'
import { contentRegionPixels, detailPanelGeometry } from '@shared/contentRegion'

/** Identical fit/overview graph for final exports and the model's review images. */
export function fitRegionGraph(
  input: string, output: string, prefix: string, source: { width: number; height: number },
  width: number, height: number, region?: ContentRegion, overview = false
): string {
  const pixels = region ? contentRegionPixels(region, source.width, source.height) : null
  const crop = pixels ? `crop=${pixels.width}:${pixels.height}:${pixels.x}:${pixels.y},` : ''
  const fit = (h: number): string => `scale=${width}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`
  if (!overview || !pixels) return `[${input}]${crop}${fit(height)}[${output}]`
  const panels = detailPanelGeometry(height)
  const stroke = Math.max(2, Math.round(source.width / 320))
  return `[${input}]split=2[${prefix}Context][${prefix}Detail];` +
    `[${prefix}Context]drawbox=x=${pixels.x}:y=${pixels.y}:w=${pixels.width}:h=${pixels.height}:color=0x60a5fa:t=${stroke},` +
    `${fit(panels.overviewHeight)},pad=${width}:${height}:0:0:color=black[${prefix}Base];` +
    `[${prefix}Detail]${crop}${fit(panels.detailHeight)}[${prefix}Inset];` +
    `[${prefix}Base][${prefix}Inset]overlay=0:${panels.detailTop}[${output}]`
}
