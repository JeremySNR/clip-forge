import { describe, expect, it } from 'vitest'
import {
  classifyClipContent,
  applyVisualLayout,
  automaticLayoutShots,
  validLayoutShots,
  bridgeTransitionLayouts,
  clipAllowsAutoZoom,
  editDefaultsForContentType,
  SCREENCAST_FACE_COVERAGE
} from '@shared/contentType'
import type { ClipEditState } from '@shared/types'

const baseEdit = (): ClipEditState => ({
  aspect: '9:16',
  reframeMode: 'crop',
  framing: 'auto',
  tightenCuts: true,
  autoZoom: true,
  focusX: 0.3,
  captionsEnabled: true,
  captionStyleId: 'beast',
  showTitle: false,
  start: 0,
  end: 30
})

describe('visual content preservation', () => {
  const assessment = { start: 0, end: 30, preserveContext: true, allowZoom: false, reason: 'Keep the puzzle and both hands visible' }
  it('preserves essential content even when face tracking found a speaker', () => {
    const edit = applyVisualLayout(baseEdit(), assessment, 'auto')
    // Camera footage fills the canvas with a blurred copy rather than black bars.
    expect(edit.reframeMode).toBe('fit-blur')
    expect(edit.autoZoom).toBe(false)
    expect(edit.framing).toBe('manual')
    expect(applyVisualLayout(baseEdit(), { ...assessment, kind: 'screen' }, 'auto').reframeMode).toBe('fit-letterbox')
  })
  it('keeps ordinary interviews cropped but disables unsafe zoom', () => {
    const edit = applyVisualLayout(baseEdit(), { ...assessment, preserveContext: false }, 'auto')
    expect(edit.reframeMode).toBe('crop')
    expect(edit.framing).toBe('auto')
    expect(edit.autoZoom).toBe(false)
  })
  it('respects explicit talking-head mode and ignores stale interval assessments', () => {
    expect(applyVisualLayout(baseEdit(), assessment, 'talking-head').reframeMode).toBe('crop')
    const extended = { ...baseEdit(), end: 35 }
    expect(applyVisualLayout(extended, assessment, 'auto')).toBe(extended)
    expect(applyVisualLayout(baseEdit(), undefined, 'auto').reframeMode).toBe('crop')
  })
  it('uses shot boundaries only for complete, current automatic plans', () => {
    const plan = { ...assessment, shots: [
      { start: 0, end: 10, mode: 'fit' as const }, { start: 10, end: 30, mode: 'crop' as const }
    ] }
    const edit = applyVisualLayout(baseEdit(), plan, 'auto')
    expect(edit.framing).toBe('auto')
    expect(automaticLayoutShots({ edit, visualLayout: plan })).toHaveLength(2)
    expect(automaticLayoutShots({ edit: { ...edit, framing: 'manual' }, visualLayout: plan })).toEqual([])
    expect(validLayoutShots({ ...plan, shots: [{ start: 1, end: 30, mode: 'fit' }] }, 0, 30)).toBe(false)
    expect(validLayoutShots({ ...plan, shots: [{ start: 0, end: 31, mode: 'fit' }] }, 0, 30)).toBe(false)
  })
  it('does not flash letterbox between two ordinary talking shots', () => {
    const shots: Array<{ start: number; end: number; mode: 'crop' | 'fit' }> = [
      { start: 0, end: 10, mode: 'crop' }, { start: 10, end: 10.04, mode: 'fit' }, { start: 10.04, end: 20, mode: 'crop' }
    ]
    bridgeTransitionLayouts(shots, [{ start: 10, end: 10.04 }])
    expect(shots.map(s => s.mode)).toEqual(['crop', 'crop', 'crop'])
    shots[1].mode = 'fit'
    shots[2].mode = 'fit'
    bridgeTransitionLayouts(shots, [{ start: 10, end: 10.04 }])
    expect(shots[1].mode).toBe('fit')
  })
})

describe('classifyClipContent', () => {
  it('marks sparse faces as screencast', () => {
    expect(classifyClipContent(0)).toBe('screencast')
    expect(classifyClipContent(SCREENCAST_FACE_COVERAGE - 0.01)).toBe('screencast')
  })

  it('marks sustained faces as speaker', () => {
    expect(classifyClipContent(SCREENCAST_FACE_COVERAGE)).toBe('speaker')
    expect(classifyClipContent(0.8)).toBe('speaker')
  })

  it('marks missing focus tracks as screencast', () => {
    expect(classifyClipContent(0.8, false)).toBe('screencast')
  })
})

describe('editDefaultsForContentType', () => {
  it('letterboxes screencasts and disables zoom', () => {
    const out = editDefaultsForContentType(baseEdit(), 'screencast')
    expect(out.reframeMode).toBe('fit-letterbox')
    expect(out.autoZoom).toBe(false)
    expect(out.framing).toBe('manual')
    expect(out.focusX).toBe(0.5)
  })

  it('leaves speaker clips unchanged', () => {
    const edit = baseEdit()
    expect(editDefaultsForContentType(edit, 'speaker')).toBe(edit)
  })
})

describe('clipAllowsAutoZoom', () => {
  it('allows zoom only on cropped reframes with auto zoom enabled', () => {
    expect(clipAllowsAutoZoom({ ...baseEdit(), autoZoom: true, reframeMode: 'crop' })).toBe(true)
    expect(clipAllowsAutoZoom({ ...baseEdit(), autoZoom: true, reframeMode: 'fit-letterbox' })).toBe(
      false
    )
    expect(clipAllowsAutoZoom({ ...baseEdit(), autoZoom: false, reframeMode: 'crop' })).toBe(false)
  })
})
