import type { Clip } from './types'

/**
 * Per-clip undo/redo over what the user owns: the edit state, text, B-roll
 * and manually set layouts. Analysis results (focus track, automatic layout)
 * are never undone. Typing and drags update the clip locally many times
 * before one save, so a step is recorded against the last *saved* state.
 */

type Snapshot = Pick<Clip, 'edit' | 'title' | 'hook' | 'caption' | 'broll' | 'visualLayout'>

const LIMIT = 100

interface History { saved: Snapshot; past: Snapshot[]; future: Snapshot[] }
const histories = new Map<string, History>()

function snapshot(clip: Clip): Snapshot {
  return structuredClone({ edit: clip.edit, title: clip.title, hook: clip.hook, caption: clip.caption,
    broll: clip.broll, visualLayout: clip.visualLayout })
}

const same = (a: Snapshot, b: Snapshot): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Apply a snapshot, keeping analysis-owned layout unless the user had set one. */
function restore(clip: Clip, s: Snapshot): Clip {
  const manual = (s.visualLayout?.revision ?? 0) > 0 || (clip.visualLayout?.revision ?? 0) > 0
  return { ...clip, ...structuredClone(s), visualLayout: manual ? structuredClone(s.visualLayout) : clip.visualLayout }
}

/** Start tracking a clip as saved (on opening the editor); keeps existing history. */
export function trackClip(clip: Clip): void {
  if (!histories.has(clip.id)) histories.set(clip.id, { saved: snapshot(clip), past: [], future: [] })
}

/** Record a save. Returns true when it created an undo step. */
export function recordSave(clip: Clip): boolean {
  const history = histories.get(clip.id)
  const next = snapshot(clip)
  if (!history) { histories.set(clip.id, { saved: next, past: [], future: [] }); return false }
  if (same(history.saved, next)) return false
  history.past.push(history.saved)
  if (history.past.length > LIMIT) history.past.shift()
  history.future = []
  history.saved = next
  return true
}

/** The clip as it was one step back, or null. */
export function undo(clip: Clip): Clip | null {
  const history = histories.get(clip.id)
  const previous = history?.past.pop()
  if (!history || !previous) return null
  history.future.push(snapshot(clip))
  history.saved = previous
  return restore(clip, previous)
}

/** The clip one step forward again, or null. */
export function redo(clip: Clip): Clip | null {
  const history = histories.get(clip.id)
  const next = history?.future.pop()
  if (!history || !next) return null
  history.past.push(snapshot(clip))
  history.saved = next
  return restore(clip, next)
}

export function historyState(clipId: string): { canUndo: boolean; canRedo: boolean } {
  const history = histories.get(clipId)
  return { canUndo: Boolean(history?.past.length), canRedo: Boolean(history?.future.length) }
}

/** Forget history (project closed or regenerated). */
export function clearHistory(): void {
  histories.clear()
}
