import { describe, expect, it } from 'vitest'
import { autoRemovedRanges, clipKeptSegments, editedClipDuration, normalizeRanges, subtractRanges } from '@shared/tighten'
import type { Clip, ClipEditState, Transcript } from '@shared/types'

/** Words every 0.5 s except a 3 s pause between 5 and 8. */
const transcript: Transcript = {
  language: 'en', durationSec: 20,
  segments: [{ id: 0, start: 0, end: 20, text: '', words: [
    ...Array.from({ length: 10 }, (_, i) => ({ text: `a${i}`, start: i * 0.5, end: i * 0.5 + 0.4 })),
    ...Array.from({ length: 24 }, (_, i) => ({ text: `b${i}`, start: 8 + i * 0.5, end: 8 + i * 0.5 + 0.4 }))
  ] }]
}
const clip = (edit: Partial<ClipEditState>): Pick<Clip, 'edit' | 'visualStory'> =>
  ({ edit: { start: 0, end: 20, tightenCuts: false, ...edit } as ClipEditState })

describe('range helpers', () => {
  it('normalizes, clips and merges ranges', () => {
    expect(normalizeRanges([{ start: 5, end: 3 }, { start: 4, end: 6 }, { start: -1, end: 0.5 }, { start: 30, end: 40 }], 0, 20))
      .toEqual([{ start: 0, end: 0.5 }, { start: 3, end: 6 }])
  })
  it('subtracts cuts', () => {
    expect(subtractRanges([{ start: 0, end: 10 }], [{ start: 2, end: 3 }, { start: 9, end: 12 }]))
      .toEqual([{ start: 0, end: 2 }, { start: 3, end: 9 }])
  })
})

describe('clipKeptSegments', () => {
  it('plays the whole trim when there is nothing to remove', () => {
    expect(clipKeptSegments(clip({}), transcript)).toBeNull()
    expect(editedClipDuration(clip({}), transcript)).toBe(20)
  })

  it('removes a manual cut even without a transcript or pause removal', () => {
    expect(clipKeptSegments(clip({ cuts: [{ start: 2, end: 4 }] }), null)).toEqual([{ start: 0, end: 2 }, { start: 4, end: 20 }])
    expect(editedClipDuration(clip({ cuts: [{ start: 2, end: 4 }] }), null)).toBe(18)
  })

  it('combines automatic pause removal with cuts and restored pauses', () => {
    const auto = clipKeptSegments(clip({ tightenCuts: true }), transcript)!
    const removed = autoRemovedRanges(clip({ tightenCuts: true }), transcript)
    expect(removed.length).toBeGreaterThan(0)
    expect(removed.some(r => r.start >= 4.5 && r.end <= 8.5)).toBe(true)
    // Putting the pause back plays it again.
    expect(clipKeptSegments(clip({ tightenCuts: true, restored: removed }), transcript)).toBeNull()
    expect(editedClipDuration(clip({ tightenCuts: true, restored: removed }), transcript)).toBe(20)
    expect(auto.reduce((s, r) => s + r.end - r.start, 0)).toBeLessThan(20)
    // A cut always wins, including over a restored pause.
    const cut = clipKeptSegments(clip({ tightenCuts: true, restored: removed, cuts: [{ start: 10, end: 12 }] }), transcript)!
    expect(cut.some(r => r.start < 11 && r.end > 11)).toBe(false)
  })

  it('ignores cuts outside the trim and drops slivers left between cuts', () => {
    expect(clipKeptSegments(clip({ cuts: [{ start: 30, end: 40 }] }), null)).toBeNull()
    expect(clipKeptSegments(clip({ cuts: [{ start: 2, end: 4 }, { start: 4.05, end: 6 }] }), null))
      .toEqual([{ start: 0, end: 2 }, { start: 6, end: 20 }])
  })
})
