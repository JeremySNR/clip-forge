import { describe, expect, it } from 'vitest'
import {
  classifyClipContent,
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

describe('classifyClipContent', () => {
  it('marks sparse faces as screencast', () => {
    expect(classifyClipContent(0)).toBe('screencast')
    expect(classifyClipContent(SCREENCAST_FACE_COVERAGE - 0.01)).toBe('screencast')
  })

  it('marks sustained faces as speaker', () => {
    expect(classifyClipContent(SCREENCAST_FACE_COVERAGE)).toBe('speaker')
    expect(classifyClipContent(0.8)).toBe('speaker')
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
