/**
 * Caption style presets, shared by the renderer (live preview) and the main
 * process (ASS subtitle generation for burn-in).
 *
 * Colours are plain hex strings ("#RRGGBB"); the ASS generator converts them
 * to libass &HBBGGRR& form.
 */

export interface CaptionStyle {
  id: string
  name: string
  fontFamily: string
  /** Font size as a fraction of video height. */
  fontScale: number
  uppercase: boolean
  textColor: string
  /** Colour of the currently spoken word. */
  highlightColor: string
  /** Optional pill behind the active word (ASS BorderStyle 3 on highlight layer). */
  highlightBoxColor: string | null
  outlineColor: string
  outlineWidth: number
  shadow: number
  bold: boolean
  /** Vertical anchor as fraction of video height measured from the top. */
  positionY: number
  /** Max words shown per caption group. */
  wordsPerGroup: number
}

export const CAPTION_STYLES: CaptionStyle[] = [
  {
    id: 'beast',
    name: 'Beast',
    fontFamily: 'Arial',
    fontScale: 0.052,
    uppercase: true,
    textColor: '#FFFFFF',
    highlightColor: '#FFD400',
    highlightBoxColor: null,
    outlineColor: '#000000',
    outlineWidth: 3.2,
    shadow: 1,
    bold: true,
    positionY: 0.72,
    wordsPerGroup: 3
  },
  {
    id: 'karaoke',
    name: 'Karaoke',
    fontFamily: 'Arial',
    fontScale: 0.046,
    uppercase: false,
    textColor: '#FFFFFF',
    highlightColor: '#4ADE80',
    highlightBoxColor: null,
    outlineColor: '#000000',
    outlineWidth: 2.6,
    shadow: 1,
    bold: true,
    positionY: 0.74,
    wordsPerGroup: 4
  },
  {
    id: 'pill',
    name: 'Pill',
    fontFamily: 'Arial',
    fontScale: 0.044,
    uppercase: true,
    textColor: '#FFFFFF',
    highlightColor: '#FFFFFF',
    highlightBoxColor: '#7C3AED',
    outlineColor: '#000000',
    outlineWidth: 0,
    shadow: 0,
    bold: true,
    positionY: 0.74,
    wordsPerGroup: 3
  },
  {
    id: 'minimal',
    name: 'Minimal',
    fontFamily: 'Arial',
    fontScale: 0.038,
    uppercase: false,
    textColor: '#FFFFFF',
    highlightColor: '#FFFFFF',
    highlightBoxColor: null,
    outlineColor: '#000000',
    outlineWidth: 1.6,
    shadow: 0,
    bold: false,
    positionY: 0.8,
    wordsPerGroup: 6
  }
]

export const DEFAULT_CAPTION_STYLE_ID = 'beast'

export function getCaptionStyle(id: string): CaptionStyle {
  return CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0]
}
