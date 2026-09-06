import { describe, expect, it } from 'vitest'
import {
  EAGER_REFRAME_MAX,
  EAGER_REFRAME_MIN,
  EAGER_REFRAME_SCORE,
  mergeReframeResult,
  needsReframe,
  selectEagerReframeIds
} from '@shared/reframe'
import type { Clip } from '@shared/types'

function clip(id: string, score: number, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    suggestedStart: 0,
    suggestedEnd: 30,
    title: id,
    hook: '',
    summary: '',
    viralityScore: score,
    viralityReason: '',
    visualSummary: null,
    hashtags: [],
    thumbnailPath: null,
    focusTrack: null,
    reframeStatus: 'pending',
    broll: [],
    edit: {
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'manual',
      tightenCuts: true,
      autoZoom: true,
      focusX: 0.5,
      captionsEnabled: true,
      captionStyleId: 'beast',
      showTitle: false,
      start: 0,
      end: 30
    },
    ...overrides
  }
}

describe('selectEagerReframeIds', () => {
  it('always takes the top clips however they score', () => {
    const ranked = Array.from({ length: 20 }, (_, i) => clip(`c${i}`, 50 - i))
    const eager = selectEagerReframeIds(ranked)
    expect(eager.size).toBe(EAGER_REFRAME_MIN)
    for (let i = 0; i < EAGER_REFRAME_MIN; i++) expect(eager.has(`c${i}`)).toBe(true)
  })

  it('extends the tier for exceptional scores, up to the cap', () => {
    const ranked = Array.from({ length: 20 }, (_, i) => clip(`c${i}`, 95 - i)) // 95..76
    const eager = selectEagerReframeIds(ranked)
    // Scores 95..84 are at/above the threshold: twelve clips, exactly the cap.
    expect(eager.size).toBe(EAGER_REFRAME_MAX)
    expect(eager.has(`c${EAGER_REFRAME_MAX - 1}`)).toBe(true)
    expect(eager.has(`c${EAGER_REFRAME_MAX}`)).toBe(false)
  })

  it('never exceeds the cap even when everything scores high', () => {
    const ranked = Array.from({ length: 40 }, (_, i) => clip(`c${i}`, 99))
    expect(selectEagerReframeIds(ranked).size).toBe(EAGER_REFRAME_MAX)
  })

  it('skips clips below the score threshold once the minimum is filled', () => {
    const ranked = [
      ...Array.from({ length: EAGER_REFRAME_MIN }, (_, i) => clip(`top${i}`, 90)),
      clip('strong', EAGER_REFRAME_SCORE),
      clip('weak', EAGER_REFRAME_SCORE - 1),
      clip('strongLater', 99)
    ]
    const eager = selectEagerReframeIds(ranked)
    expect(eager.has('strong')).toBe(true)
    expect(eager.has('weak')).toBe(false)
    // Ranked input is score-ordered, so a later high score cannot happen in
    // practice; the rule still admits it, which keeps the function total.
    expect(eager.has('strongLater')).toBe(true)
  })

  it('takes every clip when there are fewer than the minimum', () => {
    const ranked = [clip('a', 10), clip('b', 5)]
    expect(selectEagerReframeIds(ranked)).toEqual(new Set(['a', 'b']))
  })
})

describe('needsReframe', () => {
  it('is true only for pending clips', () => {
    expect(needsReframe(clip('a', 50))).toBe(true)
    expect(needsReframe(clip('a', 50, { reframeStatus: 'done' }))).toBe(false)
    // Older projects never carried the field; loadProject fills 'done' in,
    // but a bare clip object must still read as analysed.
    expect(needsReframe(clip('a', 50, { reframeStatus: undefined }))).toBe(false)
  })
})

describe('mergeReframeResult', () => {
  const analysed = clip('a', 50, {
    reframeStatus: 'done',
    contentType: 'speaker',
    focusTrack: [{ t: 0, x: 0.3, cut: true }],
    edit: {
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'auto',
      tightenCuts: true,
      autoZoom: true,
      focusX: 0.3,
      captionsEnabled: true,
      captionStyleId: 'beast',
      showTitle: false,
      start: 0,
      end: 30
    }
  })

  it('takes the analysis-owned fields and layout from the analysed clip', () => {
    const merged = mergeReframeResult(clip('a', 50), analysed)
    expect(merged.reframeStatus).toBe('done')
    expect(merged.contentType).toBe('speaker')
    expect(merged.focusTrack).toEqual([{ t: 0, x: 0.3, cut: true }])
    expect(merged.edit.framing).toBe('auto')
    expect(merged.edit.focusX).toBe(0.3)
  })

  it('keeps everything the user may have edited meanwhile', () => {
    const edited = clip('a', 50, {
      title: 'Renamed while analysing',
      caption: 'A social caption',
      edit: {
        aspect: '1:1',
        reframeMode: 'crop',
        framing: 'manual',
        tightenCuts: false,
        autoZoom: true,
        focusX: 0.5,
        captionsEnabled: false,
        captionStyleId: 'neon',
        captionFontFamily: 'My Brand Font',
        showTitle: true,
        start: 2,
        end: 28
      }
    })
    const merged = mergeReframeResult(edited, analysed)
    expect(merged.title).toBe('Renamed while analysing')
    expect(merged.caption).toBe('A social caption')
    expect(merged.edit).toMatchObject({
      aspect: '1:1',
      tightenCuts: false,
      captionsEnabled: false,
      captionStyleId: 'neon',
      captionFontFamily: 'My Brand Font',
      showTitle: true,
      start: 2,
      end: 28
    })
  })

  it('applies a screencast verdict as letterbox with no zoom', () => {
    const screencast = clip('a', 50, {
      reframeStatus: 'done',
      contentType: 'screencast',
      edit: { ...analysed.edit, reframeMode: 'fit-letterbox', framing: 'manual', focusX: 0.5, autoZoom: false }
    })
    const merged = mergeReframeResult(clip('a', 50), screencast)
    expect(merged.edit.reframeMode).toBe('fit-letterbox')
    expect(merged.edit.autoZoom).toBe(false)
    expect(merged.focusTrack).toBeNull()
  })
})
