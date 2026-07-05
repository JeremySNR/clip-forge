import type { Transcript } from './types'
import type { KeptSegment } from './tighten'

/**
 * Auto zoom: a deterministic, scene-aware zoom plan shared by the live
 * preview (CSS transform) and the export (ffmpeg zoompan), so both render
 * the same motion.
 *
 * The plan encodes short-form editing practice:
 * - "Cut" steps — instant zoom changes that alternate between wide and tight
 *   at every tighten-cut boundary, so removing ums/pauses reads as an
 *   intentional camera change instead of a stutter.
 * - "Punch" — a fast (~0.3s) push-in on the speaker's most energetic line,
 *   the classic emphasis pattern interrupt; at most two per clip so it stays
 *   an interrupt rather than the pattern.
 * - "Creep" — a slow, subtle zoom across long uncut stretches so no frame
 *   sits static for 6+ seconds, released with a snap back (which itself
 *   reads as a cut).
 */

export type ZoomStyle = 'cut' | 'punch' | 'creep'

export interface ZoomEvent {
  /** Transition window in source-video seconds (start === end for 'cut'). */
  start: number
  end: number
  /** Zoom factor before and after the transition. */
  from: number
  to: number
  style: ZoomStyle
}

/** Tight step used to disguise tighten-cut joins. */
const CUT_ZOOM = 1.12
/** Fast push-in for emphasis. */
const PUNCH_ZOOM = 1.16
const PUNCH_RAMP_SEC = 0.28
/** Longest tight hold after a punch before snapping back wide. */
const PUNCH_MAX_HOLD_SEC = 4
/** Max extra zoom accumulated by a slow creep. */
const CREEP_ZOOM = 1.08
/** Segments quieter than this never trigger a punch. */
const PUNCH_ENERGY = 0.75
/** Minimum gap between any two zoom events. */
const MIN_GAP_SEC = 1.2
/** Uncut stretches longer than this get a creep so the frame never sits still. */
const CREEP_MIN_SEC = 6
/**
 * Long stretches creep in cycles (ramp in, snap back, ramp again) instead of
 * one glacial ramp: each snap-back doubles as a pattern interrupt, and the
 * shorter ramp is fast enough to read as motion.
 */
const CREEP_CYCLE_SEC = 8
const MAX_PUNCHES = 2

interface Boundary {
  t: number
  kind: 'cut' | 'punch-start' | 'cut-punch'
  /** Punch windows carry their span; cuts are instantaneous. */
  end?: number
}

/**
 * Build the zoom plan for a clip. `keptSegments` comes from tighten cuts
 * (null when tighten is off or nothing was removed); energy comes from the
 * transcript's per-segment vocal-energy annotations when present.
 */
export function computeZoomEvents(
  transcript: Transcript | null,
  clipStart: number,
  clipEnd: number,
  keptSegments: KeptSegment[] | null
): ZoomEvent[] {
  const boundaries: Boundary[] = []

  // 1. Tighten-cut joins: the moment playback lands on the next kept span.
  if (keptSegments) {
    for (let i = 1; i < keptSegments.length; i++) {
      boundaries.push({ t: keptSegments[i].start, kind: 'cut' })
    }
  }

  // 2. Emphasis punch-ins on the most energetic sentences. Lines running
  // past the clip end still count — the punch lands where they begin.
  if (transcript) {
    const candidates = transcript.segments
      .filter(
        (s) =>
          (s.energy ?? 0) >= PUNCH_ENERGY &&
          s.start >= clipStart + 1 &&
          s.start <= clipEnd - 2 &&
          Math.min(s.end, clipEnd) - s.start >= 1.5
      )
      .sort((a, b) => (b.energy ?? 0) - (a.energy ?? 0))
      .slice(0, MAX_PUNCHES)
    for (const seg of candidates) {
      boundaries.push({
        t: seg.start,
        kind: 'punch-start',
        end: Math.min(seg.end, clipEnd - 0.2, seg.start + PUNCH_MAX_HOLD_SEC)
      })
    }
  }

  // Sort and enforce breathing room. An energetic line frequently starts
  // exactly at a tighten join (fillers removed right before the reveal), so
  // a colliding cut + punch merges into one "cut straight to tight" event
  // instead of dropping the emphasis.
  boundaries.sort((a, b) => a.t - b.t)
  const spaced: Boundary[] = []
  for (const b of boundaries) {
    const last = spaced[spaced.length - 1]
    if (!last || b.t - last.t >= MIN_GAP_SEC) {
      spaced.push(b)
      continue
    }
    if (last.kind === 'cut' && b.kind === 'punch-start') {
      last.kind = 'cut-punch'
      last.end = b.end
    }
    // Otherwise the earlier boundary wins and this one is dropped.
  }

  // 3. Walk the boundaries building alternating zoom levels.
  const events: ZoomEvent[] = []
  let level = 1
  for (const b of spaced) {
    switch (b.kind) {
      case 'cut': {
        const next = level === 1 ? CUT_ZOOM : 1
        events.push({ start: b.t, end: b.t, from: level, to: next, style: 'cut' })
        level = next
        break
      }
      case 'punch-start': {
        if (b.end === undefined) break
        // Push in fast from wherever we are, snap back to wide at the line end.
        events.push({
          start: b.t,
          end: Math.min(b.t + PUNCH_RAMP_SEC, b.end),
          from: level,
          to: PUNCH_ZOOM,
          style: 'punch'
        })
        events.push({ start: b.end, end: b.end, from: PUNCH_ZOOM, to: 1, style: 'cut' })
        level = 1
        break
      }
      case 'cut-punch': {
        if (b.end === undefined) break
        // The join lands directly on the tight emphasis framing.
        events.push({ start: b.t, end: b.t, from: level, to: PUNCH_ZOOM, style: 'cut' })
        events.push({ start: b.end, end: b.end, from: PUNCH_ZOOM, to: 1, style: 'cut' })
        level = 1
        break
      }
      default: {
        const exhaustive: never = b.kind
        return exhaustive
      }
    }
  }

  // Keep events time-ordered before zoomAt checks stretches for existing zoom.
  events.sort((a, b) => a.start - b.start || a.end - b.end)

  // 4. Slow creep across long still stretches (no event within them), in
  // cycles: ramp in over ~8s, snap back to wide, ramp again. The final cycle
  // releases INTO the next zoom event when one follows — that step itself
  // reads as a cut — and snaps back on its own only at the clip tail.
  const anchors = [clipStart, ...events.map((e) => e.end), clipEnd].sort((a, b) => a - b)
  const creeps: ZoomEvent[] = []
  for (let i = 0; i < anchors.length - 1; i++) {
    const from = anchors[i]
    const to = anchors[i + 1]
    if (to - from < CREEP_MIN_SEC) continue
    if (events.some((e) => e.start > from && e.start < to)) continue
    const isTail = i === anchors.length - 2
    const stretchStart = from + 0.4
    const stretchEnd = isTail ? to - 0.4 : to
    if (stretchEnd - stretchStart < CREEP_MIN_SEC - 1) continue
    // Only creep from a wide level: creeping on top of a tight step over-zooms.
    if (zoomAt(events, stretchStart) > 1.001) continue

    let cycleStart = stretchStart
    while (stretchEnd - cycleStart >= CREEP_MIN_SEC - 1) {
      const cycleEnd = Math.min(cycleStart + CREEP_CYCLE_SEC, stretchEnd)
      creeps.push({ start: cycleStart, end: cycleEnd, from: 1, to: CREEP_ZOOM, style: 'creep' })
      const releasesIntoNextEvent = !isTail && cycleEnd >= stretchEnd - 0.01
      if (!releasesIntoNextEvent) {
        creeps.push({ start: cycleEnd, end: cycleEnd, from: CREEP_ZOOM, to: 1, style: 'cut' })
      }
      cycleStart = cycleEnd
    }
  }
  events.push(...creeps)

  events.sort((a, b) => a.start - b.start || a.end - b.end)
  return events
}

/** Zoom factor at a moment in source time (1 = no zoom). */
export function zoomAt(events: ZoomEvent[], t: number): number {
  let z = 1
  for (const e of events) {
    if (t < e.start) break
    if (t >= e.end) {
      z = e.to
    } else {
      const p = (t - e.start) / Math.max(0.001, e.end - e.start)
      // Punches ease out (fast attack, soft landing); creeps are linear.
      const eased = e.style === 'punch' ? p * (2 - p) : p
      z = e.from + (e.to - e.from) * eased
    }
  }
  return z
}

/**
 * Remap events into clip-relative output time via a mapper (identity for
 * untightened clips, TimeMap.toOutput for tightened ones), dropping events
 * that collapse to nothing inside removed spans.
 */
export function remapZoomEvents(
  events: ZoomEvent[],
  toOutput: (t: number) => number
): ZoomEvent[] {
  return events
    .map((e) => ({ ...e, start: toOutput(e.start), end: toOutput(e.end) }))
    .filter((e, i, all) => {
      if (e.style !== 'cut' && e.end - e.start < 0.05) return false
      // Drop consecutive events remapped onto the same instant.
      const prev = all[i - 1]
      return !(prev && e.style === 'cut' && prev.style === 'cut' && e.start - prev.start < 0.05)
    })
}
