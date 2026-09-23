import { beforeEach, describe, expect, it } from 'vitest'
import { clearHistory, historyState, recordSave, redo, trackClip, undo } from '@shared/editHistory'
import type { Clip } from '@shared/types'

const base = { id: 'c', title: 'T', hook: '', caption: '', broll: [], focusTrack: [{ t: 0, x: 0.5 }],
  edit: { start: 0, end: 20, cuts: [] } } as unknown as Clip

beforeEach(() => clearHistory())

describe('edit history', () => {
  it('undoes and redoes saved edits in order', () => {
    trackClip(base)
    const cut = { ...base, edit: { ...base.edit, cuts: [{ start: 2, end: 4 }] } }
    const trimmed = { ...cut, edit: { ...cut.edit, end: 15 } }
    expect(recordSave(cut)).toBe(true)
    expect(recordSave(trimmed)).toBe(true)
    const back = undo(trimmed)!
    expect(back.edit.end).toBe(20)
    expect(back.edit.cuts).toEqual([{ start: 2, end: 4 }])
    const first = undo(back)!
    expect(first.edit.cuts).toEqual([])
    expect(undo(first)).toBeNull()
    expect(redo(first)!.edit.cuts).toEqual([{ start: 2, end: 4 }])
  })

  it('records one step per save, not per local keystroke, and ignores no-op saves', () => {
    trackClip(base)
    expect(recordSave(base)).toBe(false)
    expect(recordSave({ ...base, title: 'Final title' })).toBe(true)
    expect(historyState('c')).toEqual({ canUndo: true, canRedo: false })
  })

  it('never undoes analysis results such as the focus track', () => {
    trackClip(base)
    recordSave({ ...base, title: 'New' })
    const analysed = { ...base, title: 'New', focusTrack: [{ t: 0, x: 0.2 }] }
    expect(undo(analysed)!.focusTrack).toEqual([{ t: 0, x: 0.2 }])
  })

  it('a new edit after undo clears redo', () => {
    trackClip(base)
    const a = { ...base, title: 'A' }
    recordSave(a)
    const back = undo(a)!
    recordSave({ ...back, title: 'B' })
    expect(historyState('c').canRedo).toBe(false)
  })
})
