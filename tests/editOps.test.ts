import { describe, expect, it } from 'vitest'
import { cutRange, keepsPlayback, pieceAt, setTrimEdge, splitAt, timelinePieces, toggleRestored, uncutAt, wordsRange } from '@shared/editOps'
import type { ClipEditState } from '@shared/types'

const edit = { start: 10, end: 30 } as ClipEditState

describe('razor and pieces', () => {
  it('splits the timeline into selectable pieces', () => {
    const split = splitAt(splitAt(edit, 20), 15)
    expect(split.splits).toEqual([15, 20])
    expect(timelinePieces(split)).toEqual([{ start: 10, end: 15 }, { start: 15, end: 20 }, { start: 20, end: 30 }])
    expect(pieceAt(split, 17)).toEqual({ start: 15, end: 20 })
  })
  it('selects nothing outside the trim', () => {
    const split = splitAt(edit, 20)
    expect(pieceAt(split, 5)).toBeUndefined()
    expect(pieceAt(split, 31)).toBeUndefined()
    expect(pieceAt(split, 30)).toEqual({ start: 20, end: 30 })
  })

  it('refuses a cut that leaves nothing to play', () => {
    expect(keepsPlayback({ edit: cutRange(edit, { start: 10, end: 30 }) }, null)).toBe(false)
    expect(keepsPlayback({ edit: cutRange(edit, { start: 10, end: 29.5 }) }, null)).toBe(false)
    expect(keepsPlayback({ edit: cutRange(edit, { start: 10, end: 20 }) }, null)).toBe(true)
  })

  it('ignores splits at the edges or on top of another split', () => {
    expect(splitAt(edit, 10.01)).toBe(edit)
    const once = splitAt(edit, 20)
    expect(splitAt(once, 20.02)).toBe(once)
  })
})

describe('cuts', () => {
  it('cuts a piece and puts it back', () => {
    const cut = cutRange(edit, { start: 15, end: 20 })
    expect(cut.cuts).toEqual([{ start: 15, end: 20 }])
    expect(uncutAt(cut, 17).cuts).toEqual([])
    expect(uncutAt(cut, 25)).toBe(cut)
  })
  it('merges overlapping cuts', () => {
    expect(cutRange(cutRange(edit, { start: 12, end: 15 }), { start: 14, end: 18 }).cuts).toEqual([{ start: 12, end: 18 }])
  })
  it('toggles a restored pause', () => {
    const pause = { start: 12, end: 13 }
    const kept = toggleRestored(edit, pause)
    expect(kept.restored).toEqual([pause])
    expect(toggleRestored(kept, pause).restored).toEqual([])
  })
})

describe('word ranges and trim edges', () => {
  const words = [{ start: 1, end: 1.4 }, { start: 1.6, end: 2 }, { start: 3, end: 3.5 }]
  it('cuts words from the middle of the gaps around them', () => {
    expect(wordsRange(words, 1, 1)).toEqual({ start: 1.5, end: 2.5 })
    expect(wordsRange(words, 0, 0)).toEqual({ start: 1, end: 1.5 })
  })
  it('keeps a minimum clip length when setting in and out', () => {
    expect(setTrimEdge(edit, 'start', 29.8).start).toBe(29)
    expect(setTrimEdge(edit, 'end', 5).end).toBe(11)
    expect(setTrimEdge(edit, 'start', -3).start).toBe(0)
  })
})
