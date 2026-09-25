import { expect, it } from 'vitest'
import type { SourceMomentCandidate } from '@shared/sourceAnalysis'
import type { Transcript } from '@shared/types'
import { clipKeptSegments } from '@shared/tighten'
import { visualCandidateClip } from '../src/main/pipeline/visualCandidates'
import { makeTranscript } from './helpers'

const candidate: SourceMomentCandidate = {
  id: 'event', start: 2, end: 10, title: 'A working mechanism', summary: 'The mechanism turns on.',
  reason: 'The setup and visible result are both present.', score: 72, kind: 'demonstration',
  evidence: [{ time: 2, role: 'before', observation: 'Stopped wheel' },
    { time: 6, role: 'action', observation: 'Hand operates lever' },
    { time: 9, role: 'result', observation: 'Wheel turning' }],
  protectedRange: { start: 2, end: 10 }, sampleTimes: [2, 6, 9], timingUncertaintySec: 1
}
const silent: Transcript = { language: 'en', durationSec: 20, segments: [], speech: [] }

it('retains silent action with safe framing and no invented captions or hook', () => {
  const clip = visualCandidateClip(candidate, silent, 20, 45)!
  expect(clip.discovery).toEqual({ origin: 'visual', evidenceTimes: [2, 6, 9] })
  expect(clip.edit).toMatchObject({ captionsEnabled: false, tightenCuts: false, autoZoom: false, reframeMode: 'fit-letterbox' })
  expect(clip.hook).toBe('')
  expect(clipKeptSegments(clip, silent)).toBeNull()
  // Even if the creator turns tightening on, the complete observed event remains.
  clip.edit.tightenCuts = true
  const kept = clipKeptSegments(clip, silent)
  expect(kept === null || kept.some(range => range.start <= 2 && range.end >= 10)).toBe(true)
})

it('expands crossing speech boundaries without cutting away the visual event', () => {
  const transcript = makeTranscript(['This is the full opening sentence.', 'And this is the closing thought.'])
  const first = transcript.segments[0], last = transcript.segments[1]
  const clip = visualCandidateClip({ ...candidate, start: first.words[1].start, end: last.words[1].end }, transcript, 20, 45)!
  expect(clip.edit.start).toBeLessThanOrEqual(first.start)
  expect(clip.edit.end).toBeGreaterThanOrEqual(last.end)
  expect(clip.edit.captionsEnabled).toBe(true)
})

it('rejects a complete event that cannot fit instead of chopping its result', () => {
  expect(visualCandidateClip(candidate, silent, 20, 5)).toBeNull()
  expect(visualCandidateClip({ ...candidate, end: 21 }, silent, 20, 45)).toBeNull()
  expect(visualCandidateClip({ ...candidate, start: NaN }, silent, 20, 45)).toBeNull()
})
