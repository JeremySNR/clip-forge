import { describe, expect, it } from 'vitest'
import {
  initialClipEditForVideoType,
  resolveContentType,
  shouldAnalyzeFaces,
  applyVideoTypeLayout
} from '@shared/videoType'
import type { ClipEditState } from '@shared/types'

const baseEdit = (): ClipEditState => ({
  aspect: '9:16',
  reframeMode: 'crop',
  framing: 'manual',
  tightenCuts: true,
  autoZoom: true,
  focusX: 0.3,
  captionsEnabled: true,
  captionStyleId: 'beast',
  showTitle: false,
  start: 0,
  end: 30
})

describe('resolveContentType', () => {
  it('forces screencast for product demos', () => {
    expect(resolveContentType('product-demo', 'speaker')).toBe('screencast')
  })

  it('forces speaker for talking-head videos', () => {
    expect(resolveContentType('talking-head', 'screencast')).toBe('speaker')
  })

  it('keeps auto-detected content for webinar and auto', () => {
    expect(resolveContentType('webinar', 'screencast')).toBe('screencast')
    expect(resolveContentType('auto', 'speaker')).toBe('speaker')
  })
})

describe('shouldAnalyzeFaces', () => {
  it('skips face tracking for product demos', () => {
    expect(shouldAnalyzeFaces('product-demo')).toBe(false)
    expect(shouldAnalyzeFaces('podcast')).toBe(true)
  })
})

describe('initialClipEditForVideoType', () => {
  it('letterboxes product demos from the start', () => {
    expect(initialClipEditForVideoType('product-demo')).toMatchObject({
      reframeMode: 'fit-letterbox',
      autoZoom: false
    })
  })
})

describe('applyVideoTypeLayout', () => {
  it('letterboxes when resolved content is screencast', () => {
    const out = applyVideoTypeLayout(baseEdit(), 'screencast', 'product-demo', null)
    expect(out.reframeMode).toBe('fit-letterbox')
    expect(out.autoZoom).toBe(false)
  })

  it('enables auto framing when a focus track exists', () => {
    const out = applyVideoTypeLayout(baseEdit(), 'speaker', 'podcast', [{ t: 0, x: 0.4 }])
    expect(out.framing).toBe('auto')
    expect(out.focusX).toBeCloseTo(0.4)
  })
})
