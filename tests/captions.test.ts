import { describe, expect, it } from 'vitest'
import { buildAss } from '../src/main/pipeline/captions'
import { makeTranscript } from './helpers'

describe('buildAss', () => {
  const transcript = makeTranscript(['hello brave new world'], { wordSec: 0.5, gapSec: 0.1 })
  const base = {
    styleId: 'beast',
    width: 1080,
    height: 1920,
    clipStart: 0,
    clipEnd: transcript.durationSec
  }

  it('emits one karaoke event per word', () => {
    const ass = buildAss(transcript, base)
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue: 0,'))
    expect(events.length).toBe(4)
  })

  it('re-bases event times to the clip start', () => {
    const shifted = makeTranscript(['late words here'], { startSec: 60 })
    const ass = buildAss(shifted, { ...base, clipStart: 60, clipEnd: 63 })
    // No event may start at/after 60s — everything is clip-relative.
    expect(ass).not.toMatch(/Dialogue: \d,0:01:/)
    expect(ass).toContain('Dialogue: 0,0:00:00')
  })

  it('adds a title event when a title is provided', () => {
    const ass = buildAss(transcript, { ...base, title: 'The Hook' })
    expect(ass).toContain('Dialogue: 1,')
    expect(ass).toContain('The Hook')
  })

  it('escapes ASS control characters in words', () => {
    const t = makeTranscript(['plain'], {})
    t.segments[0].words[0].text = '{override\\}'
    const ass = buildAss(t, { ...base, clipEnd: t.durationSec })
    // Braces and backslashes are stripped (beast style also uppercases).
    expect(ass).not.toContain('{OVERRIDE')
    expect(ass).not.toContain('OVERRIDE\\')
    expect(ass).toContain('OVERRIDE')
  })

  it('converts style colours to ASS BGR form', () => {
    const ass = buildAss(transcript, base)
    // Beast style highlight #FFD400 -> &H00D4FF (BGR).
    expect(ass).toContain('&H00D4FF&')
  })

  it('uppercases words for uppercase styles', () => {
    const ass = buildAss(transcript, base)
    expect(ass).toContain('HELLO')
  })
})
