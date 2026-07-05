import { describe, expect, it } from 'vitest'
import { applyRefinedEnding, dedupeClips, targetClipCount } from '../src/main/pipeline/highlights'
import { DEFAULT_CAPTION_STYLE_ID } from '@shared/captionStyles'
import type { Clip } from '@shared/types'

function clip(id: string, start: number, end: number, score: number): Clip {
  return {
    id,
    suggestedStart: start,
    suggestedEnd: end,
    title: id,
    hook: '',
    summary: '',
    viralityScore: score,
    viralityReason: '',
    visualSummary: null,
    hashtags: [],
    thumbnailPath: null,
    focusTrack: null,
    broll: [],
    edit: {
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'manual',
      tightenCuts: false,
      focusX: 0.5,
      captionsEnabled: true,
      captionStyleId: DEFAULT_CAPTION_STYLE_ID,
      showTitle: false,
      start,
      end
    }
  }
}

describe('dedupeClips', () => {
  it('keeps non-overlapping clips', () => {
    const clips = [clip('a', 0, 20, 90), clip('b', 30, 50, 80)]
    expect(dedupeClips(clips).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('drops a clip that substantially overlaps a higher-scored one', () => {
    const clips = [clip('winner', 0, 30, 90), clip('dupe', 5, 32, 70)]
    expect(dedupeClips(clips).map((c) => c.id)).toEqual(['winner'])
  })

  it('keeps clips with small overlaps', () => {
    // 5s overlap on 30s/25s clips = 20% of the shorter clip, under the 40% cap.
    const clips = [clip('a', 0, 30, 90), clip('b', 25, 50, 70)]
    expect(dedupeClips(clips).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('measures overlap against the shorter clip', () => {
    // The short clip sits fully inside the long one: 100% of the short clip.
    const clips = [clip('long', 0, 60, 90), clip('short', 20, 30, 85)]
    expect(dedupeClips(clips).map((c) => c.id)).toEqual(['long'])
  })
})

describe('targetClipCount', () => {
  it('asks for roughly one clip per minute of source', () => {
    expect(targetClipCount(600)).toBe(10)
    expect(targetClipCount(1800)).toBe(30)
  })

  it('never asks for fewer than 4 or more than 40', () => {
    expect(targetClipCount(30)).toBe(4)
    expect(targetClipCount(6 * 3600)).toBe(40)
  })
})

describe('applyRefinedEnding', () => {
  const segmentEnds = [10, 20, 30, 38.5, 47, 60]
  const VIDEO_DUR = 300

  it('extends the clip to the sentence that carries the payoff', () => {
    const c = applyRefinedEnding(clip('a', 5, 30.6, 90), 38.4, segmentEnds, VIDEO_DUR)
    // Snapped to the 38.5s sentence end plus the 0.6s post-roll.
    expect(c.suggestedEnd).toBeCloseTo(39.1, 3)
    expect(c.edit.end).toBeCloseTo(39.1, 3)
    expect(c.suggestedStart).toBe(5)
  })

  it('can trim back to an earlier, stronger closer', () => {
    const c = applyRefinedEnding(clip('a', 5, 47.6, 90), 38.5, segmentEnds, VIDEO_DUR)
    expect(c.suggestedEnd).toBeCloseTo(39.1, 3)
  })

  it('ignores no-op and implausible suggestions', () => {
    const original = clip('a', 5, 30.6, 90)
    // Same ending re-suggested: below the 1s change threshold.
    expect(applyRefinedEnding(original, 30, segmentEnds, VIDEO_DUR)).toBe(original)
    // Extension beyond the 45s cap.
    expect(applyRefinedEnding(clip('a', 5, 30.6, 90), 200, [200], VIDEO_DUR)).toEqual(
      clip('a', 5, 30.6, 90)
    )
    // Trim that would leave the clip shorter than the minimum.
    expect(applyRefinedEnding(clip('a', 5, 20.6, 90), 10, segmentEnds, VIDEO_DUR)).toEqual(
      clip('a', 5, 20.6, 90)
    )
    // Nonsense values.
    expect(applyRefinedEnding(original, Number.NaN, segmentEnds, VIDEO_DUR)).toBe(original)
  })

  it('clamps to the end of the video', () => {
    const c = applyRefinedEnding(clip('a', 270, 290, 90), 299.8, [299.8], 300)
    expect(c.suggestedEnd).toBe(300)
  })
})
