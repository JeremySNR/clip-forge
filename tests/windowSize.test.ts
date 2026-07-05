import { describe, expect, it } from 'vitest'
import { initialWindowSize, MIN_WINDOW } from '../src/main/windowSize'

describe('initialWindowSize', () => {
  it('leaves margin on a typical desktop display', () => {
    const size = initialWindowSize({ width: 1920, height: 1080 })
    expect(size.width).toBeLessThan(1920)
    expect(size.height).toBeLessThan(1080)
    expect(size).toEqual({ width: 1600, height: 907 })
  })

  it('never fills a small laptop display edge-to-edge above the minimum', () => {
    const size = initialWindowSize({ width: 1440, height: 900 })
    expect(size).toEqual({ width: 1210, height: 756 })
  })

  it('caps the size on very large monitors', () => {
    expect(initialWindowSize({ width: 3840, height: 2160 })).toEqual({
      width: 1600,
      height: 1000
    })
  })

  it('clamps up to the layout minimum on tiny work areas', () => {
    expect(initialWindowSize({ width: 1024, height: 640 })).toEqual(MIN_WINDOW)
  })
})
