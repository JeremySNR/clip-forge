import { join } from 'node:path'
import { app } from 'electron'
import type { Transcript } from '@shared/types'
import { getCaptionStyle, type CaptionStyle } from '@shared/captionStyles'
import { groupWords, wordsInRange, type WordGroup } from '@shared/captionLayout'

/**
 * Bundled caption fonts (Anton, Poppins — OFL licensed) so exports render
 * identically on every OS instead of falling back to system fonts.
 * `app` is undefined when running outside Electron (test scripts).
 */
export function fontsDir(): string {
  if (app?.isPackaged) return join(process.resourcesPath, 'fonts')
  const base = app?.getAppPath?.() ?? process.cwd()
  return join(base, 'resources', 'fonts')
}

/**
 * Generates ASS (Advanced SubStation Alpha) subtitles with word-level karaoke
 * highlighting: for every spoken word we emit one Dialogue event that shows
 * the whole word group with the active word emphasised. libass renders this
 * as the classic "Opus Clip" style animated captions when burned in.
 */

function assTime(sec: number): string {
  const clamped = Math.max(0, sec)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const s = Math.floor(clamped % 60)
  const cs = Math.floor((clamped - Math.floor(clamped)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** "#RRGGBB" -> ASS "&HBBGGRR&" (no alpha). */
function assColor(hex: string): string {
  const clean = hex.replace('#', '')
  const r = clean.slice(0, 2)
  const g = clean.slice(2, 4)
  const b = clean.slice(4, 6)
  return `&H${b}${g}${r}&`.toUpperCase()
}

/** "#RRGGBB" -> ASS style colour with explicit zero alpha "&H00BBGGRR". */
function assStyleColor(hex: string): string {
  const clean = hex.replace('#', '')
  const r = clean.slice(0, 2)
  const g = clean.slice(2, 4)
  const b = clean.slice(4, 6)
  return `&H00${b}${g}${r}`.toUpperCase()
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, '').replace(/[{}]/g, '').replace(/\n/g, ' ')
}

function renderGroupText(group: WordGroup, activeIndex: number, style: CaptionStyle): string {
  const highlight = assColor(style.highlightColor)
  const base = assColor(style.textColor)
  const parts: string[] = []
  for (let i = 0; i < group.words.length; i++) {
    const raw = escapeAss(group.words[i].text)
    const text = style.uppercase ? raw.toUpperCase() : raw
    if (i === activeIndex) {
      const pop = '\\t(0,70,\\fscx109\\fscy109)'
      if (style.highlightBoxColor) {
        // Fat outline in the pill colour approximates a rounded label.
        const pill = assColor(style.highlightBoxColor)
        parts.push(`{\\c${highlight}\\bord10\\3c${pill}\\fscx100\\fscy100${pop}}${text}{\\r}`)
      } else {
        parts.push(`{\\c${highlight}\\fscx100\\fscy100${pop}}${text}{\\r}`)
      }
    } else {
      parts.push(`{\\c${base}}${text}{\\r}`)
    }
  }
  return parts.join(' ')
}

export interface CaptionOptions {
  styleId: string
  /** Output video dimensions the subtitles will be rendered onto. */
  width: number
  height: number
  /** Clip boundaries in source-video seconds; events are re-based to 0. */
  clipStart: number
  clipEnd: number
  /** Optional title overlaid near the top for the first seconds of the clip. */
  title?: string
  /** Custom font family overriding the style's font (must exist in fontsdir). */
  fontFamily?: string
}

export function buildAss(transcript: Transcript, opts: CaptionOptions): string {
  const preset = getCaptionStyle(opts.styleId)
  const style = opts.fontFamily ? { ...preset, fontFamily: opts.fontFamily } : preset
  const fontSize = Math.round(style.fontScale * opts.height)
  const marginV = Math.round((1 - style.positionY) * opts.height)
  const primary = assStyleColor(style.textColor)
  const outline = assStyleColor(style.outlineColor)

  const header = `[Script Info]
Title: ClipForge captions
ScriptType: v4.00+
PlayResX: ${opts.width}
PlayResY: ${opts.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${style.fontFamily},${fontSize},${primary},${primary},${outline},&H80000000,${style.bold ? -1 : 0},0,0,0,100,100,0,0,1,${style.outlineWidth},${style.shadow},2,60,60,${marginV},1
Style: Title,${style.fontFamily},${Math.round(fontSize * 0.82)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,8,60,60,${Math.round(opts.height * 0.08)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  const lines: string[] = []
  const clipDur = opts.clipEnd - opts.clipStart

  if (opts.title && opts.title.trim().length > 0) {
    const showFor = Math.min(4, clipDur)
    lines.push(
      `Dialogue: 1,${assTime(0)},${assTime(showFor)},Title,,0,0,0,,{\\fad(150,250)}${escapeAss(opts.title.trim())}`
    )
  }

  const words = wordsInRange(transcript, opts.clipStart, opts.clipEnd)
  const groups = groupWords(words, style.wordsPerGroup)

  for (const group of groups) {
    for (let i = 0; i < group.words.length; i++) {
      const w = group.words[i]
      const start = Math.max(0, w.start - opts.clipStart)
      // Hold the last word of a group on screen until the group ends to avoid flicker.
      const isLast = i === group.words.length - 1
      const next = group.words[i + 1]
      const end = Math.min(clipDur, (isLast ? Math.max(w.end, group.end) : next.start) - opts.clipStart)
      if (end <= start) continue
      lines.push(
        `Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${renderGroupText(group, i, style)}`
      )
    }
  }

  return header + lines.join('\n') + '\n'
}
