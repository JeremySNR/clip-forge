import { describe, expect, it } from 'vitest'
import type { Clip, ContentRegion } from '@shared/types'
import { compositionPixels, presenterComposition, usefulComposition, validComposition } from '@shared/composition'
import { automaticLayoutShots, compositionHidesTitle, detailCaptionRanges, layoutReviewMessage, protectLayoutRanges, validLayoutShots } from '@shared/contentType'
import { mergeClipSave, mergeReframeResult } from '@shared/reframe'

const content = { x: .2, y: .3, width: .6, height: .6 }
const presenter = { x: .82, y: .02, width: .16, height: .26 }
const clip = (): Clip => ({ edit: { start: 10, end: 20, aspect: '9:16', reframeMode: 'crop', framing: 'auto' },
  visualLayout: { start: 10, end: 20, preserveContext: true, allowZoom: false, reason: 'screen',
    shots: [{ start: 10, end: 20, mode: 'fit', composition: presenterComposition(content, presenter),
      review: { status: 'checked', reason: 'Readable samples' } }] } }) as Clip

describe('independent presenter/content composition', () => {
  it.each([[.02, .02], [.82, .02], [.02, .72], [.82, .72]])('handles an inset at %s,%s without moving the destination', (x, y) => {
    const result = presenterComposition(content, { ...presenter, x, y })!
    expect(validComposition(result)).toBe(true)
    expect(result.layers[1].target).toEqual(presenterComposition(content, presenter)!.layers[1].target)
    expect(usefulComposition(result, { width: 1920, height: 1080 })).toBe(true)
  })

  it('rejects invalid regions, source duplication and caption collisions', () => {
    expect(presenterComposition(content, { ...presenter, x: NaN })).toBeUndefined()
    expect(presenterComposition(content, { ...presenter, width: 1 })).toBeUndefined()
    expect(presenterComposition(content, content)).toBeUndefined()
    const c = presenterComposition(content, presenter)!
    c.layers[0].target.y = .7
    expect(validComposition(c)).toBe(false)
    expect(validComposition({ ...c, layers: null } as never)).toBe(false)
  })

  it('rejects upscaling a tiny presenter and content with no useful enlargement', () => {
    const c = presenterComposition(content, presenter)!
    expect(usefulComposition(c, { width: 320, height: 180 })).toBe(false)
    const broad = presenterComposition({ x: .02, y: .3, width: .96, height: .6 }, presenter)!
    expect(usefulComposition(broad, { width: 1920, height: 1080 })).toBe(false)
  })

  it('fits even-pixel rectangles inside disjoint destinations and keeps their aspect ratio', () => {
    const c = presenterComposition(content, presenter)!
    for (const size of [{ width: 1920, height: 1080 }, { width: 641, height: 361 }]) {
      for (const p of compositionPixels(c, size, 1080, 1920)) {
        expect(Object.values(p.source).every(n => n % 2 === 0)).toBe(true)
        expect(Object.values(p.target).every(n => n % 2 === 0)).toBe(true)
        expect(p.target.x + p.target.width).toBeLessThanOrEqual(1080)
        expect(p.target.y + p.target.height).toBeLessThan(1920 * .76)
        expect(Math.abs(p.target.width / p.target.height - p.source.width / p.source.height)).toBeLessThan(.03)
      }
    }
  })

  it('preserves composites across face-detail guards, trim and layout changes', () => {
    const c = clip()
    expect(validLayoutShots(c.visualLayout, 12, 18)).toBe(true)
    expect(protectLayoutRanges(c.visualLayout, 10, 20, [{ start: 13, end: 15 }])?.shots?.every(s => s.composition)).toBe(true)
    expect(detailCaptionRanges(c)).toEqual([{ start: 10, end: 20, positionY: .83 }])
    expect(compositionHidesTitle(c)).toBe(true)
    c.edit.compositionPreference = 'stacked'
    expect(automaticLayoutShots(c)[0].composition?.preset).toBe('stacked')
    expect(automaticLayoutShots(c)[0].review?.status).toBe('needs-review')
    c.edit.compositionPreference = 'content-only'
    expect(automaticLayoutShots(c)[0].composition?.layers).toHaveLength(1)
    c.edit.aspect = '1:1'
    expect(automaticLayoutShots(c)[0].composition).toBeUndefined()
    c.edit.framing = 'manual'
    expect(automaticLayoutShots(c)).toEqual([])
    expect(compositionHidesTitle(c)).toBe(false)
  })

  it('preserves a manual region correction across save and late background analysis', () => {
    const saved = clip(), manual = clip()
    manual.visualLayout!.revision = 1
    const source: ContentRegion = { ...content, y: .25 }
    manual.visualLayout!.shots![0].composition = presenterComposition(source, presenter)
    expect(mergeClipSave(manual, saved, 'auto').visualLayout).toEqual(manual.visualLayout)
    expect(mergeReframeResult(manual, saved, 'auto').visualLayout).toEqual(manual.visualLayout)
    expect(mergeClipSave(saved, manual, 'auto').visualLayout).toEqual(manual.visualLayout)
  })

  it('keeps the full scene when a manual composition no longer covers an extended trim', () => {
    const manual = clip(), analysed = clip()
    manual.visualLayout!.revision = 1
    manual.edit.end = 25
    analysed.edit.end = 25
    analysed.reframeAnalysis = { start: 10, end: 25, version: 1 }
    analysed.visualLayout!.end = 25
    analysed.visualLayout!.shots![0].end = 25
    const merged = mergeReframeResult(manual, analysed, 'auto')
    expect(merged.visualLayout).toBe(manual.visualLayout)
    expect(automaticLayoutShots(merged)).toEqual([{ start: 10, end: 25, mode: 'fit',
      review: expect.objectContaining({ status: 'needs-review' }) }])
    expect(layoutReviewMessage(merged)).toContain('full source retained')
    merged.edit.end = 19
    expect(automaticLayoutShots(merged)[0].composition).toBeDefined()
  })
})
