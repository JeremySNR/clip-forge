import { describe, expect, it } from 'vitest'
import type { Clip } from '@shared/types'
import { computeKeptSegments, editedClipDuration, TimeMap } from '@shared/tighten'
import { applyVisualStoryProposal } from '../src/main/pipeline/visualStory'
import { plannedClipFrameTimes } from '../src/main/pipeline/visualScore'
import { makeTranscript } from './helpers'

const transcript = makeTranscript(['Watch this mechanism work'], { startSec: 1, wordSec: 1, gapSec: 0 })
const clip = { id: 'demo', title: 'Before', hook: '', summary: '', edit: { start: 0, end: 6, tightenCuts: true } } as Clip
const proposal = { can_complete: true, intervals: [{ start_frame: 0, end_frame: 1 }], title: 'Mechanism', hook: 'Watch', summary: 'Result', reason: 'Visible result' }

describe('visual story protection', () => {
  it('keeps the wordless payoff after speech and removes the wait', () => {
    const kept = computeKeptSegments(transcript, 0, 40, [{ start: 30, end: 40 }])!
    expect(kept.at(-1)).toEqual({ start: 30, end: 40 })
    const map = new TimeMap(kept)
    expect(map.isRemoved(20)).toBe(true)
    expect(map.outputDuration).toBeLessThan(16)
    expect(map.toSource(kept[0].end - kept[0].start)).toBe(30)
    expect(map.toSource(map.outputDuration)).toBe(40)
  })
  it('retains protected footage even without three spoken words', () => {
    const quiet = { ...transcript, segments: [] }
    expect(computeKeptSegments(quiet, 0, 40, [{ start: 30, end: 50 }])).toEqual([{ start: 30, end: 40 }])
    expect(computeKeptSegments(quiet, 0, 40, [{ start: NaN, end: 50 }])).toBeNull()
  })
  it('allows a wider source span only when the actual edit fits', () => {
    const result = applyVisualStoryProposal(clip, transcript, [30, 40], proposal, 20, 100)!
    expect(result.edit.end).toBeGreaterThanOrEqual(40)
    expect(result.title).toBe('Mechanism')
    expect(result.reframeStatus).toBe('pending')
    expect(editedClipDuration(result, transcript)).toBeLessThan(20)
    expect(plannedClipFrameTimes(result, transcript).some(t => t >= 30)).toBe(true)
    expect(plannedClipFrameTimes(result, transcript).some(t => t > 6 && t < 30)).toBe(false)
    expect(applyVisualStoryProposal({ ...clip, edit: { ...clip.edit, tightenCuts: false } }, transcript, [30, 40], proposal, 20, 100)).toBeNull()
    expect(applyVisualStoryProposal(clip, transcript, [30, 60], proposal, 20, 100)).toBeNull()
  })
  it('rejects invalid frame selections and times', () => {
    for (const intervals of [[{ start_frame: -1, end_frame: 1 }], [{ start_frame: 1, end_frame: 0 }], [{ start_frame: 0, end_frame: 2 }]]) {
      expect(applyVisualStoryProposal(clip, transcript, [30, 40], { ...proposal, intervals }, 20, 100)).toBeNull()
    }
    expect(applyVisualStoryProposal(clip, transcript, [3, 40], proposal, 50, 100)).toBeNull()
  })
  it('nested ranges cannot truncate the later visual ending', () => {
    const result = applyVisualStoryProposal(clip, transcript, [20, 25, 30, 40], {
      ...proposal, intervals: [{ start_frame: 0, end_frame: 3 }, { start_frame: 1, end_frame: 2 }]
    }, 30, 100)!
    expect(result.edit.end).toBeGreaterThanOrEqual(40)
  })
  it('finishes a word crossing the selected final frame without entering the next word', () => {
    const spoken = makeTranscript(['Result complete'], { startSec: 39.8, wordSec: .6, gapSec: .2 })
    const result = applyVisualStoryProposal(clip, spoken, [30, 40], proposal, 20, 100)!
    expect(result.edit.end).toBeGreaterThanOrEqual(40.4)
    expect(result.edit.end).toBeLessThan(40.6)
    expect(result.visualStory!.protectedRanges.at(-1)!.end).toBe(result.edit.end)
  })
})
