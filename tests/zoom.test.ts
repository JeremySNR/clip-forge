import { describe, expect, it } from 'vitest'
import { computeZoomEvents, fitZoomEvents, remapZoomEvents, zoomAt, type ZoomEvent } from '@shared/zoom'
import { zoomExpression } from '../src/main/pipeline/render'
import { makeTranscript } from './helpers'
import type { KeptSegment } from '@shared/tighten'

describe('computeZoomEvents', () => {
  it('places alternating jump zooms at tighten-cut joins', () => {
    const kept: KeptSegment[] = [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
      { start: 12, end: 16 }
    ]
    const events = computeZoomEvents(null, 0, 16, kept)
    const cuts = events.filter((e) => e.style === 'cut' && e.start === e.end)
    expect(cuts.length).toBeGreaterThanOrEqual(2)
    // First join punches in, second releases back to wide.
    expect(cuts[0].start).toBe(6)
    expect(cuts[0].to).toBeGreaterThan(1)
    expect(cuts[1].start).toBe(12)
    expect(cuts[1].to).toBe(1)
  })

  it('punches in on the most energetic sentences, capped at two', () => {
    const transcript = makeTranscript(
      ['calm sentence one here', 'very loud line here', 'calm again now', 'another loud one here', 'third loud line here'],
      { wordSec: 0.5, gapSec: 0.1, sentenceGapSec: 0.3 }
    )
    transcript.segments[1].energy = 0.95
    transcript.segments[3].energy = 0.9
    transcript.segments[4].energy = 0.85
    const clipEnd = transcript.durationSec + 2
    const events = computeZoomEvents(transcript, 0, clipEnd, null)
    const punches = events.filter((e) => e.style === 'punch')
    expect(punches.length).toBeLessThanOrEqual(2)
    expect(punches.length).toBeGreaterThan(0)
    expect(punches[0].to).toBeGreaterThan(1.1)
  })

  it('adds a slow creep on long still stretches and none on short clips', () => {
    const events = computeZoomEvents(null, 10, 30, null)
    const creeps = events.filter((e) => e.style === 'creep')
    expect(creeps.length).toBeGreaterThan(0)
    expect(creeps[0].to).toBeLessThan(1.1)
    expect(computeZoomEvents(null, 0, 4, null)).toEqual([])
  })
})

describe('zoomAt', () => {
  const events: ZoomEvent[] = [
    { start: 2, end: 2, from: 1, to: 1.12, style: 'cut' },
    { start: 5, end: 5.3, from: 1.12, to: 1.16, style: 'punch' },
    { start: 8, end: 8, from: 1.16, to: 1, style: 'cut' }
  ]

  it('holds levels between events and steps at cuts', () => {
    expect(zoomAt(events, 0)).toBe(1)
    expect(zoomAt(events, 2)).toBeCloseTo(1.12)
    expect(zoomAt(events, 4.9)).toBeCloseTo(1.12)
    expect(zoomAt(events, 9)).toBe(1)
  })

  it('interpolates inside a punch ramp', () => {
    const mid = zoomAt(events, 5.15)
    expect(mid).toBeGreaterThan(1.12)
    expect(mid).toBeLessThan(1.16)
  })
})

describe('remapZoomEvents', () => {
  it('shifts events into clip-relative time and drops collapsed ramps', () => {
    const events: ZoomEvent[] = [
      { start: 12, end: 12, from: 1, to: 1.12, style: 'cut' },
      { start: 14, end: 20, from: 1, to: 1.06, style: 'creep' }
    ]
    // Untightened clip starting at 10s: identity minus clipStart.
    const out = remapZoomEvents(events, (t) => t - 10)
    expect(out[0].start).toBe(2)
    // A mapper that collapses the creep window drops it.
    const collapsed = remapZoomEvents(events, () => 3)
    expect(collapsed.some((e) => e.style === 'creep')).toBe(false)
  })
})

/** Deepest parenthesis nesting in an expression. */
function maxNestingDepth(expr: string): number {
  let depth = 0
  let max = 0
  for (const ch of expr) {
    if (ch === '(') max = Math.max(max, ++depth)
    else if (ch === ')') depth--
  }
  return max
}

describe('zoomExpression', () => {
  it('builds a piecewise ffmpeg expression over input frames', () => {
    const expr = zoomExpression(
      [
        { start: 1, end: 1, from: 1, to: 1.12, style: 'cut' },
        { start: 4, end: 4.3, from: 1.12, to: 1.16, style: 'punch' }
      ],
      30
    )
    expect(expr).toContain('(in/30.000)')
    // Before the first event the frame is unzoomed.
    expect(expr.startsWith('lt((in/30.000),1.000)*(1)+')).toBe(true)
    // The instant cut holds a constant level from its own start…
    expect(expr).toContain('gte((in/30.000),1.000)*lt((in/30.000),4.000)*(1.1200)')
    // …and the punch ramps from there by the remaining 0.04 over 0.3s.
    expect(expr).toContain('1.1200+0.0400*')
    expect(expr).toContain('/0.300)')
    // Balanced parentheses (cheap structural sanity check).
    const open = (expr.match(/\(/g) ?? []).length
    const close = (expr.match(/\)/g) ?? []).length
    expect(open).toBe(close)
  })

  /**
   * ffmpeg's expression parser gives up at around 85 pieces however they are
   * arranged, so a whole-video plan of hundreds of events must come out both
   * flat and bounded.
   */
  it('stays flat and bounded however many events there are', () => {
    const events = Array.from({ length: 400 }, (_, i) => ({
      start: i * 2,
      end: i * 2 + 0.3,
      from: 1,
      to: 1.12,
      style: 'punch' as const
    }))
    const few = zoomExpression(events.slice(0, 3), 30)
    const many = zoomExpression(events, 30)
    expect(maxNestingDepth(many)).toBe(maxNestingDepth(few))
    expect(maxNestingDepth(many)).toBeLessThan(20)
    expect(many).not.toContain('if(')
    // One gate per surviving piece, and the plan is capped under the limit.
    expect((many.match(/gte\(/g) ?? []).length).toBeLessThanOrEqual(64)
  })
})

describe('fitZoomEvents', () => {
  const creepCycle = (start: number): ZoomEvent[] => [
    { start, end: start + 8, from: 1, to: 1.08, style: 'creep' },
    { start: start + 8, end: start + 8, from: 1.08, to: 1, style: 'cut' }
  ]

  it('leaves a plan that already fits alone', () => {
    const events = [...creepCycle(0), ...creepCycle(10)]
    expect(fitZoomEvents(events, 64)).toEqual(events)
  })

  it('drops creeps and their releases before cuts and punches', () => {
    const punch: ZoomEvent = { start: 100, end: 100.3, from: 1, to: 1.16, style: 'punch' }
    const events = [
      ...Array.from({ length: 40 }, (_, i) => creepCycle(i * 10)).flat(),
      punch
    ]
    const fitted = fitZoomEvents(events, 64)
    expect(fitted.some((e) => e.style === 'creep')).toBe(false)
    expect(fitted).toEqual([{ ...punch, from: 1 }])
  })

  it('re-anchors survivors so the plan stays continuous', () => {
    const events: ZoomEvent[] = Array.from({ length: 200 }, (_, i) => ({
      start: i * 2,
      end: i * 2,
      from: i % 2 === 0 ? 1 : 1.12,
      to: i % 2 === 0 ? 1.12 : 1,
      style: 'cut'
    }))
    const fitted = fitZoomEvents(events, 64)
    expect(fitted.length).toBeLessThanOrEqual(64)
    // Every piece starts where the previous one left off, so no dropped event
    // leaves a step the zoom never actually made.
    let level = 1
    for (const e of fitted) {
      expect(e.from).toBeCloseTo(level, 6)
      level = e.to
    }
  })
})
