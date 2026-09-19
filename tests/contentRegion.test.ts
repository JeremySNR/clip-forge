import { describe, it, expect } from 'vitest'
import { contentRegionPixels, proposedContentRegion, validContentRegion } from '@shared/contentRegion'
import { previewRegionStyle, type PreviewFramePlan } from '@shared/previewFrame'
import { applyVisualLayout, automaticLayoutShots, protectLayoutRanges } from '@shared/contentType'
import type { Clip } from '@shared/types'

describe('content region geometry', () => {
  it('rejects non-finite, reversed, tiny and out-of-source proposals', () => {
    for (const box of [undefined, { left: NaN, top: 0, right: 700, bottom: 900 },
      { left: 700, top: 0, right: 600, bottom: 900 }, { left: 0, top: 0, right: 20, bottom: 1000 },
      { left: 0, top: -10, right: 500, bottom: 900 }]) expect(proposedContentRegion(box)).toBeUndefined()
    expect(proposedContentRegion({ left: 0, top: 0, right: 1000, bottom: 1000 })).toBeUndefined()
  })
  it('pads a valid proposal and rounds its boundaries outward to even pixels', () => {
    const region = proposedContentRegion({ left: 250, top: 100, right: 750, bottom: 950 })!
    expect(validContentRegion(region)).toBe(true)
    const pixels = contentRegionPixels(region, 1920, 1080)
    expect(pixels.x).toBeLessThanOrEqual(region.x * 1920)
    expect(pixels.x + pixels.width).toBeGreaterThanOrEqual((region.x + region.width) * 1920)
    expect([pixels.x, pixels.y, pixels.width, pixels.height].every(n => n % 2 === 0)).toBe(true)
  })
  it('preview fits the retained region and masks discarded picture, then resets outside it', () => {
    const plan: PreviewFramePlan = { isCrop: true, framing: 'auto', manualFocusX: .5, focusTrack: null, zoomEvents: null,
      fitRanges: [{ start: 10, end: 20, region: { x: .25, y: 0, width: .5, height: 1 } }] }
    expect(previewRegionStyle(plan, 15, 1920, 1080, 1080, 1920)).toEqual({ transform: 'translate(0px,0px) scale(2)', clipPath: 'inset(656.25px 270px 656.25px 270px)' })
    expect(previewRegionStyle(plan, 20, 1920, 1080, 1080, 1920)).toBeNull()
    expect(previewRegionStyle({ ...plan, isCrop: false }, 15, 1920, 1080, 1080, 1920)).toBeNull()
  })
  it('low-detail speaker protection preserves an independently verified object region', () => {
    const region = { x: .25, y: 0, width: .5, height: 1 }
    const layout: Clip['visualLayout'] = { start: 10, end: 20, preserveContext: true, allowZoom: false, reason: 'Object', shots: [{ start: 10, end: 20, mode: 'fit', region }] }
    const guarded = protectLayoutRanges(layout, 10, 20, [{ start: 12, end: 18 }])!
    expect(guarded.shots!.every(s => s.region === region)).toBe(true)
    const edit = applyVisualLayout({ start: 10, end: 20, aspect: '9:16' } as Clip['edit'], guarded, 'auto')
    expect(edit.framing).toBe('auto')
    expect(automaticLayoutShots({ edit, visualLayout: guarded })).toHaveLength(3)
    expect(automaticLayoutShots({ edit: { ...edit, framing: 'manual' }, visualLayout: guarded })).toEqual([])
  })
})
