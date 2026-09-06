import { describe, expect, it } from 'vitest'
import { buildAss } from '../src/main/pipeline/captions'
import { makeTranscript } from './helpers'
import { CAPTION_HOLD_SEC } from '@shared/captionLayout'

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

  it('centres every caption block on the style anchor line, matching the preview', () => {
    const ass = buildAss(transcript, base)
    // Beast anchors at 72% of the frame height; \\an5 centres the block there.
    expect(ass).toContain('{\\an5\\pos(540,1382)}')
    // Wrapping is ours, not libass's: no auto-wrap, middle-centre style.
    expect(ass).toContain('WrapStyle: 2')
    expect(ass).toMatch(/Style: Caption,[^\n]*,1,3.2,1,5,54,54,0,1/)
  })

  it('breaks lines itself with \\N when a group needs two lines', () => {
    // Seven short words in the small "whisper" style on a 9:16 frame lay out
    // as two lines; the export must carry that break explicitly.
    const t = makeTranscript(['captions that run long enough to wrap around'], {
      wordSec: 0.3,
      gapSec: 0.05
    })
    const ass = buildAss(t, { ...base, styleId: 'whisper', clipEnd: t.durationSec })
    expect(ass).toContain('\\N')
  })

  it('holds the last word of a group on screen briefly, but never into the next group', () => {
    const t = makeTranscript(['first line.', 'second line.'], {
      wordSec: 0.5,
      gapSec: 0.1,
      sentenceGapSec: 4
    })
    const ass = buildAss(t, { ...base, clipEnd: t.durationSec })
    const events = ass
      .split('\n')
      .filter((l) => l.startsWith('Dialogue: 0,'))
      .map((l) => l.split(',').slice(1, 3))
    // Group one's last word is spoken 0.6-1.1s; its event runs on by the hold.
    expect(events[1]).toEqual(['0:00:00.60', '0:00:02.60'])
    expect(CAPTION_HOLD_SEC).toBe(1.5)
    // The next group's first word starts at 5.2s, well after the hold ended.
    expect(events[2][0]).toBe('0:00:05.20')
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

  it('uses the style font by default and honours a custom font override', () => {
    expect(buildAss(transcript, base)).toContain('Style: Caption,Anton,')
    const ass = buildAss(transcript, { ...base, fontFamily: 'My Brand Font' })
    expect(ass).toContain('Style: Caption,My Brand Font,')
    expect(ass).toContain('Style: Title,My Brand Font,')
  })
})
