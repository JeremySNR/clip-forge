import type { Composition, ContentRegion } from '@shared/types'
import { contentRegionPixels, detailPanelGeometry } from '@shared/contentRegion'
import { compositionPixels } from '@shared/composition'

/** One decoded stream, bounded branches, identical fit geometry to the preview. */
export function compositionGraph(
  input: string, output: string, prefix: string, source: { width: number; height: number },
  width: number, height: number, composition: Composition
): string {
  const layers = compositionPixels(composition, source, width, height)
  if (!layers.length) throw new Error('Invalid composition')
  const parts = [`[${input}]split=${layers.length + 1}[${prefix}BaseInput]${layers.map((_, i) => `[${prefix}Input${i}]`).join('')}`,
    // Blacken the 2x2 seed before padding: a full-frame drawbox fill costs a
    // per-pixel blend of every output frame (~0.4 s per second of 1080x1920).
    `[${prefix}BaseInput]scale=2:2,drawbox=color=black:t=fill,pad=${width}:${height}:0:0:color=black[${prefix}Base]`]
  for (const [i, { source: s, target: d }] of layers.entries()) {
    parts.push(`[${prefix}Input${i}]crop=${s.width}:${s.height}:${s.x}:${s.y},scale=${d.width}:${d.height}:flags=lanczos,setsar=1[${prefix}Layer${i}]`)
    parts.push(`[${i === 0 ? `${prefix}Base` : `${prefix}Out${i - 1}`}][${prefix}Layer${i}]overlay=${d.x}:${d.y}:eof_action=pass[${i === layers.length - 1 ? output : `${prefix}Out${i}`}]`)
  }
  return parts.join(';')
}

/**
 * Identical fit/overview graph for final exports and the model's review images.
 * `blur` fills the unused canvas with a blurred, darkened copy of the full
 * frame instead of black (camera footage; overview layouts keep black).
 */
export function fitRegionGraph(
  input: string, output: string, prefix: string, source: { width: number; height: number },
  width: number, height: number, region?: ContentRegion, overview = false, blur = false
): string {
  const pixels = region ? contentRegionPixels(region, source.width, source.height) : null
  const crop = pixels ? `crop=${pixels.width}:${pixels.height}:${pixels.x}:${pixels.y},` : ''
  const fit = (h: number): string => `scale=${width}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`
  if (blur && !overview) {
    // Blur at an eighth of the size: the same look as a full-size blur for a
    // fraction of the cost, since this branch renders every output frame.
    const even = (v: number): number => Math.max(2, Math.round(v / 16) * 2)
    return `[${input}]split=2[${prefix}Back][${prefix}Front];` +
      `[${prefix}Back]scale=${even(width)}:${even(height)}:force_original_aspect_ratio=increase,crop=${even(width)}:${even(height)},` +
      `gblur=sigma=3,eq=brightness=-0.12,scale=${width}:${height},setsar=1[${prefix}Blur];` +
      `[${prefix}Front]${crop}scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[${prefix}Fit];` +
      `[${prefix}Blur][${prefix}Fit]overlay=(W-w)/2:(H-h)/2[${output}]`
  }
  if (!overview || !pixels) return `[${input}]${crop}${fit(height)}[${output}]`
  const panels = detailPanelGeometry(height)
  const stroke = Math.max(2, Math.round(source.width / 320))
  return `[${input}]split=2[${prefix}Context][${prefix}Detail];` +
    `[${prefix}Context]drawbox=x=${pixels.x}:y=${pixels.y}:w=${pixels.width}:h=${pixels.height}:color=0x60a5fa:t=${stroke},` +
    `${fit(panels.overviewHeight)},pad=${width}:${height}:0:0:color=black[${prefix}Base];` +
    `[${prefix}Detail]${crop}${fit(panels.detailHeight)}[${prefix}Inset];` +
    `[${prefix}Base][${prefix}Inset]overlay=0:${panels.detailTop}[${output}]`
}
