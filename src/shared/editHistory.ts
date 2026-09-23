import type { Clip } from './types'

/**
 * Per-clip undo/redo of the user's own edits.
 *
 * Each step records only the fields that save actually changed, with their
 * values before and after, so undo touches nothing else. Results merged in
 * from elsewhere (reframe analysis, generated captions) are absorbed into the
 * baseline with `noteExternal` instead of becoming steps, so undoing a cut can
 * never put back an old crop or an old caption.
 *
 * Typing and drags update the clip locally many times before one save, so a
 * step is measured against the last *saved* state, not the live copy.
 */

const LIMIT = 100

/** Top-level clip fields the user edits; edit fields are tracked one by one. */
const CLIP_KEYS = ['title', 'hook', 'caption', 'broll', 'visualLayout'] as const
/** Framing that reframe analysis rewrites until the user chooses a layout. */
const FRAMING_KEYS = ['edit.reframeMode', 'edit.framing', 'edit.focusX', 'edit.autoZoom', 'edit.compositionPreference']
/** What reframe analysis and caption generation write without a user save. */
const EXTERNAL_KEYS = [...FRAMING_KEYS, 'visualLayout', 'caption']

type Values = Map<string, string>
interface Change { key: string; before: string | undefined; after: string | undefined }
interface History { saved: Values; past: Change[][]; future: Change[][] }
const histories = new Map<string, History>()

function values(clip: Clip): Values {
  const out: Values = new Map()
  for (const key of CLIP_KEYS) out.set(key, JSON.stringify(clip[key] ?? null))
  for (const [key, value] of Object.entries(clip.edit)) out.set(`edit.${key}`, JSON.stringify(value ?? null))
  return out
}

function apply(clip: Clip, changes: Change[], side: 'before' | 'after'): Clip {
  const next: Clip = { ...clip, edit: { ...clip.edit } }
  for (const change of changes) {
    const raw = change[side]
    const value = raw === undefined ? undefined : JSON.parse(raw)
    if (change.key.startsWith('edit.')) {
      const field = change.key.slice(5) as keyof Clip['edit']
      if (value === null || value === undefined) delete next.edit[field]
      else (next.edit as unknown as Record<string, unknown>)[field] = value
    } else {
      (next as unknown as Record<string, unknown>)[change.key] = value ?? undefined
    }
  }
  return next
}

/** Start tracking a clip as last saved; keeps existing history. */
export function trackClip(clip: Clip): void {
  if (!histories.has(clip.id)) histories.set(clip.id, { saved: values(clip), past: [], future: [] })
}

/** Absorb results that arrived from analysis or caption generation. */
export function noteExternal(clip: Clip): void {
  const history = histories.get(clip.id)
  if (!history) return
  const current = values(clip)
  for (const key of EXTERNAL_KEYS) {
    if (current.has(key)) history.saved.set(key, current.get(key)!)
    else history.saved.delete(key)
  }
}

/** Record a save. Returns true when it created an undo step. */
export function recordSave(clip: Clip): boolean {
  const history = histories.get(clip.id)
  const next = values(clip)
  if (!history) { histories.set(clip.id, { saved: next, past: [], future: [] }); return false }
  const keys = new Set([...history.saved.keys(), ...next.keys()])
  const changes: Change[] = []
  for (const key of keys) {
    const before = history.saved.get(key), after = next.get(key)
    // Until the user picks a layout (layoutChosen), framing differences are
    // analysis results, even if they reached this save unannounced.
    if (before !== after && (clip.edit.layoutChosen || !FRAMING_KEYS.includes(key))) changes.push({ key, before, after })
  }
  if (!changes.length) return false
  history.past.push(changes)
  if (history.past.length > LIMIT) history.past.shift()
  history.future = []
  history.saved = next
  return true
}

function step(clip: Clip, from: 'past' | 'future'): Clip | null {
  const history = histories.get(clip.id)
  const changes = history?.[from].pop()
  if (!history || !changes) return null
  const side = from === 'past' ? 'before' : 'after'
  const next = apply(clip, changes, side)
  for (const change of changes) {
    const value = change[side]
    if (value === undefined) history.saved.delete(change.key)
    else history.saved.set(change.key, value)
  }
  history[from === 'past' ? 'future' : 'past'].push(changes)
  return next
}

/** The clip with the last recorded step undone, or null. */
export function undo(clip: Clip): Clip | null {
  return step(clip, 'past')
}

/** The clip with the last undone step reapplied, or null. */
export function redo(clip: Clip): Clip | null {
  return step(clip, 'future')
}

export function historyState(clipId: string): { canUndo: boolean; canRedo: boolean } {
  const history = histories.get(clipId)
  return { canUndo: Boolean(history?.past.length), canRedo: Boolean(history?.future.length) }
}

/** Forget history (project closed or regenerated). */
export function clearHistory(): void {
  histories.clear()
}
