import { randomUUID } from 'node:crypto'
import type { Clip, Transcript } from '@shared/types'
import type { SourceMomentCandidate } from '@shared/sourceAnalysis'
import { DEFAULT_CAPTION_STYLE_ID } from '@shared/captionStyles'
import { padSpeechEnd, padSpeechStart, transcriptSentences } from '@shared/sentences'

/** Retain the complete observed event and any sentence crossing its edges.
 * Reject an over-budget story instead of manufacturing an incomplete short. */
export function visualCandidateClip(
  candidate: SourceMomentCandidate, transcript: Transcript, durationSec: number, maxDurationSec: number
): Clip | null {
  if (![candidate.start, candidate.end, durationSec, maxDurationSec].every(Number.isFinite) ||
      candidate.start < 0 || candidate.end > durationSec || candidate.end <= candidate.start) return null
  const sentences = transcriptSentences(transcript)
  const opening = sentences.find(s => s.start < candidate.start && s.end > candidate.start)
  const closing = sentences.find(s => s.start < candidate.end && s.end > candidate.end)
  const start = opening ? padSpeechStart(opening.start, transcript) : candidate.start
  const end = closing ? padSpeechEnd(closing.end, transcript, durationSec) : candidate.end
  if (end - start > maxDurationSec || end - start < 1) return null
  const speech = transcript.segments.some(s => s.end > start && s.start < end)
  return {
    id: randomUUID(), origin: 'ai-highlight',
    discovery: { origin: 'visual', evidenceTimes: candidate.evidence.map(e => e.time) },
    suggestedStart: start, suggestedEnd: end,
    title: candidate.title, hook: '', summary: candidate.summary,
    viralityScore: candidate.score, viralityReason: candidate.reason,
    visualSummary: null, hashtags: [], thumbnailPath: null, focusTrack: null,
    reframeStatus: 'pending', broll: [],
    visualStory: { protectedRanges: [{ start: candidate.start, end: candidate.end }], reason: candidate.reason },
    visualLayout: { start, end, preserveContext: true, allowZoom: false,
      reason: 'Keep the complete visual event visible until its composition has been reviewed.' },
    edit: {
      aspect: '9:16', reframeMode: 'fit-letterbox', framing: 'auto', focusX: .5,
      tightenCuts: false, autoZoom: false, captionsEnabled: speech,
      captionStyleId: DEFAULT_CAPTION_STYLE_ID, showTitle: false, start, end
    }
  }
}
