import { describe, expect, it } from 'vitest'
import { buildAss } from '../src/main/pipeline/captions'
import { DEFAULT_BRAND_COLORS, getCaptionStyle, resolveCaptionStyle } from '../src/shared/captionStyles'
import { makeTranscript } from './helpers'

describe('resolveCaptionStyle', () => {
  it('returns the preset unchanged when brand colours are disabled', () => {
    const style = resolveCaptionStyle('beast', DEFAULT_BRAND_COLORS)
    expect(style.highlightColor).toBe('#FFD400')
  })

  it('overrides highlight colour on text-highlight styles when enabled', () => {
    const style = resolveCaptionStyle('beast', {
      ...DEFAULT_BRAND_COLORS,
      enabled: true,
      primaryColor: '#A855F7'
    })
    expect(style.highlightColor).toBe('#A855F7')
  })

  it('maps primary/secondary onto pill styles when enabled', () => {
    const style = resolveCaptionStyle('pill', {
      ...DEFAULT_BRAND_COLORS,
      enabled: true,
      primaryColor: '#A855F7',
      secondaryColor: '#FFFFFF'
    })
    expect(style.highlightBoxColor).toBe('#A855F7')
    expect(style.highlightColor).toBe('#FFFFFF')
  })

  it('honours optional text and outline overrides', () => {
    const style = resolveCaptionStyle('beast', {
      ...DEFAULT_BRAND_COLORS,
      enabled: true,
      textColor: '#E4E4E7',
      outlineColor: '#18181B'
    })
    expect(style.textColor).toBe('#E4E4E7')
    expect(style.outlineColor).toBe('#18181B')
  })

  it('applies a custom font family override', () => {
    const preset = getCaptionStyle('beast')
    const style = resolveCaptionStyle('beast', null, 'My Brand Font')
    expect(style.fontFamily).toBe('My Brand Font')
    expect(style.highlightColor).toBe(preset.highlightColor)
  })
})

describe('buildAss brand colours', () => {
  const transcript = makeTranscript(['hello world'], { wordSec: 0.5, gapSec: 0.1 })
  const base = {
    styleId: 'beast',
    width: 1080,
    height: 1920,
    clipStart: 0,
    clipEnd: transcript.durationSec
  }

  it('uses the brand highlight colour in ASS output when enabled', () => {
    const ass = buildAss(transcript, {
      ...base,
      brandColors: {
        ...DEFAULT_BRAND_COLORS,
        enabled: true,
        primaryColor: '#A855F7'
      }
    })
    // #A855F7 -> BGR &HF755A8 (inline karaoke tag)
    expect(ass).toContain('&HF755A8&')
    expect(ass).not.toContain('&H00D4FF&')
  })
})
