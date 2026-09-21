import type { Composition, ContentRegion } from './types'
import { contentRegionPixels } from './contentRegion'

export function validRectangle(r: ContentRegion | undefined): r is ContentRegion {
  return Boolean(r && [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
    r.x >= 0 && r.y >= 0 && r.width >= .02 && r.height >= .02 &&
    r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001)
}

function intersection(a: ContentRegion, b: ContentRegion): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
}

export function validComposition(c: Composition | undefined): c is Composition {
  if (!c || c.version !== 1 || !['content-first', 'stacked', 'content-only'].includes(c.preset) ||
    !Array.isArray(c.layers) || c.layers.length < 1 || c.layers.length > 2 ||
    !Number.isFinite(c.captionY) || c.captionY < .78 || c.captionY > .86) return false
  const roles = new Set<string>()
  for (const layer of c.layers) {
    if (!layer || !['content', 'presenter'].includes(layer.role) || roles.has(layer.role) ||
      !validRectangle(layer.source) || !validRectangle(layer.target) ||
      layer.target.y + layer.target.height > c.captionY - .07) return false
    roles.add(layer.role)
  }
  return roles.has('content') && (c.layers.length === 1 || intersection(c.layers[0].target, c.layers[1].target) < .000001)
}

/** The source rectangles are independent of the source webcam's corner. */
export function presenterComposition(
  content: ContentRegion, presenter: ContentRegion,
  preset: Composition['preset'] = 'content-first'
): Composition | undefined {
  if (!validRectangle(content) || !validRectangle(presenter) ||
    intersection(content, presenter) > presenter.width * presenter.height * .15) return undefined
  const layers: Composition['layers'] = [{ role: 'content', source: content,
    target: preset === 'content-only' ? { x: .04, y: .08, width: .92, height: .66 } :
      { x: .04, y: .29, width: .92, height: .46 } }]
  if (preset !== 'content-only') layers.push({ role: 'presenter', source: presenter,
    target: preset === 'stacked' ? { x: .12, y: .03, width: .76, height: .23 } :
      { x: .64, y: .03, width: .30, height: .23 } })
  return { version: 1, preset, layers, captionY: .83 }
}

/** Return the actual fitted rectangles, not an approximate CSS contain calculation. */
export function compositionPixels(c: Composition, source: { width: number; height: number }, width: number, height: number):
  Array<{ source: ContentRegion; target: ContentRegion }> {
  if (!validComposition(c) || Math.min(source.width, source.height, width, height) < 2) return []
  return c.layers.map(layer => {
    const crop = contentRegionPixels(layer.source, source.width, source.height)
    const panel = contentRegionPixels(layer.target, width, height)
    const scale = Math.min(panel.width / crop.width, panel.height / crop.height)
    const w = Math.max(2, Math.floor(crop.width * scale / 2) * 2)
    const h = Math.max(2, Math.floor(crop.height * scale / 2) * 2)
    return { source: crop, target: { x: panel.x + Math.floor((panel.width - w) / 4) * 2,
      y: panel.y + Math.floor((panel.height - h) / 4) * 2, width: w, height: h } }
  })
}

/** Keep small insets from becoming soft close-ups and require a useful content gain. */
export function usefulComposition(c: Composition, source: { width: number; height: number }): boolean {
  const pixels = compositionPixels(c, source, 1080, 1920)
  const baseline = Math.min(1080 / source.width, 1920 / source.height)
  return pixels.length > 0 && pixels.every((p, i) => c.layers[i].role === 'content'
    ? p.target.width / p.source.width >= baseline * 1.2
    : Math.min(p.source.width, p.source.height) >= 80 && p.target.width / p.source.width <= 3)
}
