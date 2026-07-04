import { create } from 'zustand'

/**
 * Shared playback state between the preview player and the editor sidebar
 * (timeline playhead, transcript active-word highlight, click-to-seek).
 * A dedicated store keeps the ~60 Hz time updates from re-rendering the
 * whole editor — consumers subscribe to exactly what they need.
 */

interface PreviewBus {
  /** Current playback position in source-video seconds. */
  time: number
  setTime: (t: number) => void
  /** Registered by the mounted PreviewPlayer. */
  seekHandler: ((t: number) => void) | null
  setSeekHandler: (fn: ((t: number) => void) | null) => void
  /** Seek the preview to a source-video time (no-op when no player mounted). */
  seek: (t: number) => void
}

export const usePreviewBus = create<PreviewBus>((set, get) => ({
  time: 0,
  setTime: (t) => set({ time: t }),
  seekHandler: null,
  setSeekHandler: (fn) => set({ seekHandler: fn }),
  seek: (t) => get().seekHandler?.(t)
}))
