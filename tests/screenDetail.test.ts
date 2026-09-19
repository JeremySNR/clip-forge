import { describe, expect, it } from 'vitest'
import { screenDetailPlan } from '../src/main/pipeline/screenDetail'
import { fitRegionGraph } from '../src/main/pipeline/layoutFilters'
import { detailCaptionRanges, automaticLayoutShots } from '@shared/contentType'
import { detailPanelGeometry, captionPositionAt, detailEnlargement, MIN_DETAIL_GAIN } from '@shared/contentRegion'
import { previewRegionStyle, type PreviewFramePlan } from '@shared/previewFrame'
import type { Clip } from '@shared/types'

const box = { left: 650, top: 200, right: 980, bottom: 630 }
const interval = { start_frame: 0, end_frame: 8, detail: true, region: box }
const times = Array.from({ length: 9 }, (_, i) => i * 2)

describe('screen-detail composition', () => {
  it('requires complete chronological coverage and rejects bad regions', () => {
    expect(screenDetailPlan(0, 16, times, [interval])?.[0].overview).toBe(true)
    expect(screenDetailPlan(0, 16, times, [{ ...interval, start_frame: 1 }])).toBeNull()
    expect(screenDetailPlan(0, 16, times, [{ ...interval, end_frame: 7 }])).toBeNull()
    expect(screenDetailPlan(0, 16, times, [{ ...interval, region: { ...box, right: 1200 } }])).toBeNull()
    expect(screenDetailPlan(0, 16, times, [{ ...interval, end_frame: 4 }, { ...interval, start_frame: 3 }])).toBeNull()
  })
  it('supports an overview-only opening before a relevant detail appears', () => {
    const shots = screenDetailPlan(0, 16, times, [{ ...interval, end_frame: 2, detail: false }, { ...interval, start_frame: 3 }])!
    expect(shots[0]).toEqual({ start: 0, end: 5, mode: 'fit' })
    expect(shots[1].start).toBe(5)
    expect(shots[1].overview).toBe(true)
  })
  it('rejects the broad article region that was still too small in the phone review', () => {
    expect(detailEnlargement({ x: .133, y: .503, width: .675, height: .35 }, 1280, 720)).toBeLessThan(MIN_DETAIL_GAIN)
    expect(detailEnlargement({ x: .651, y: .18, width: .346, height: .466 }, 1280, 720)).toBeGreaterThan(2.8)
  })
  it('keeps the enlarged detail below the caption band and the source overview above it', () => {
    const panels = detailPanelGeometry(1920)
    expect(panels).toEqual({ overviewHeight: 576, detailTop: 882, detailHeight: 882 })
    const region = { x: .65, y: .2, width: .33, height: .43 }
    const graph = fitRegionGraph('in', 'out', 'd', { width: 1280, height: 720 }, 1080, 1920, region, true)
    expect(graph).toContain('split=2[dContext][dDetail]')
    expect(graph).toContain('drawbox=')
    expect(graph).toContain('overlay=0:882[out]')
    const plan: PreviewFramePlan = { isCrop: true, framing: 'auto', manualFocusX: .5, focusTrack: null, zoomEvents: null,
      fitRanges: [{ start: 0, end: 16, region, overview: true }] }
    const style = previewRegionStyle(plan, 8, 1280, 720, 1080, 1920)!
    expect(style.clipPath).toContain('inset(')
    expect(style.transform).not.toBe(previewRegionStyle({ ...plan, fitRanges: [{ start: 0, end: 16, region }] }, 8, 1280, 720, 1080, 1920)!.transform)
  })
  it('respects manual/original framing and places captions only during detail shots', () => {
    const shots = screenDetailPlan(0, 16, times, [{ ...interval, end_frame: 2, detail: false }, { ...interval, start_frame: 3 }])!
    const clip = { edit: { start: 0, end: 16, aspect: '9:16', reframeMode: 'crop', framing: 'auto' },
      visualLayout: { start: 0, end: 16, preserveContext: true, allowZoom: false, reason: 'UI', shots } } as Clip
    const ranges = detailCaptionRanges(clip)
    expect(captionPositionAt(ranges, 4, .72)).toBe(.72)
    expect(captionPositionAt(ranges, 8, .72)).toBe(.38)
    expect(captionPositionAt(ranges, 16, .72)).toBe(.72)
    expect(automaticLayoutShots({ ...clip, edit: { ...clip.edit, aspect: 'original' } })).toEqual([])
    expect(detailCaptionRanges({ ...clip, edit: { ...clip.edit, framing: 'manual' } })).toEqual([])
  })
})
