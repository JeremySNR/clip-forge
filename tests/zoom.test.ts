import { describe, expect, it } from 'vitest'
import { computeZoomEvents, remapZoomEvents, zoomAt, type ZoomEvent } from '@shared/zoom'
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
    expect(expr).toContain('1.1200')
    expect(expr).toContain('1.1600')
    // Before the first event the zoom is 1.
    expect(expr.startsWith('if(lt((in/30.000),1.000),1,')).toBe(true)
    // Balanced parentheses (cheap structural sanity check).
    const open = (expr.match(/\(/g) ?? []).length
    const close = (expr.match(/\)/g) ?? []).length
    expect(open).toBe(close)
  })
})
