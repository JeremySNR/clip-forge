import { describe, expect, it } from 'vitest'
import { FRONTEND_BATCH_FRAMES, FRONTEND_CONTEXT_FRAMES, frontendWindows } from '../src/main/pipeline/asdFrontend'

describe('bounded speaker feature windows', () => {
  it('covers every output frame exactly once, with the temporal context intact', () => {
    for (const frames of [0, 1, 25, 26, 75, 3000]) {
      const coverage = new Uint8Array(frames)
      for (const window of frontendWindows(frames)) {
        expect(window.inputTo - window.inputFrom).toBeLessThanOrEqual(FRONTEND_BATCH_FRAMES + 2 * FRONTEND_CONTEXT_FRAMES)
        expect(window.inputFrom).toBe(Math.max(0, window.from - 9))
        expect(window.inputTo).toBe(Math.min(frames, window.to + 9))
        for (let i = window.from; i < window.to; i++) coverage[i]++
      }
      expect([...coverage].every(count => count === 1)).toBe(true)
    }
  })
})
