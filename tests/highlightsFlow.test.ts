import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectHighlights } from '../src/main/pipeline/highlights'
import { analyzeClipBoundaries } from '@shared/clipMetrics'
import { transcriptSentences } from '@shared/sentences'
import { makeTranscript } from './helpers'

/**
 * Drives the whole highlight pass — model request, boundary snapping,
 * sentence completion, the ending review, dedupe — against a scripted model.
 * chatJSON goes through global fetch, so a stub that answers each schema by
 * name stands in for OpenAI; the requests it receives are kept so the test
 * can check what the model was shown.
 */

interface Captured {
  schema: string
  user: string
}

function chatReply(payload: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

describe('detectHighlights end to end (scripted model)', () => {
  // Twelve sentences of six words: each 2.3 s of speech, 0.4 s apart, so
  // sentence k starts at 2.7k and ends at 2.7k + 2.3.
  const transcript = makeTranscript(
    Array.from({ length: 12 }, (_, i) => `sentence ${i} word three four five.`),
    { wordSec: 0.3, gapSec: 0.1, sentenceGapSec: 0.4 }
  )
  const sentences = transcriptSentences(transcript)
  const VIDEO = transcript.durationSec + 5
  const captured: Captured[] = []
  let answers: Record<string, (body: Record<string, unknown>) => unknown>

  beforeEach(() => {
    captured.length = 0
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>
        response_format: { json_schema: { name: string } }
      }
      const schema = body.response_format.json_schema.name
      captured.push({ schema, user: body.messages.find((m) => m.role === 'user')?.content ?? '' })
      const answer = answers[schema]
      if (!answer) throw new Error(`unexpected schema ${schema}`)
      return chatReply(answer(body as unknown as Record<string, unknown>))
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const raw = (start: number, end: number, score: number, title = 'A clip') => ({
    start,
    end,
    title,
    hook: 'hook',
    summary: 'summary',
    payoff: 'payoff',
    virality_score: score,
    virality_reason: 'because',
    hashtags: ['a', 'b', 'c']
  })

  it('shows the model one sentence per line with timestamps', async () => {
    answers = {
      viral_clips: () => ({ clips: [raw(sentences[1].start, sentences[5].end, 80)] }),
      clip_endings: () => ({ endings: [{ index: 0, ends_with_payoff: true, better_end: sentences[5].end, reason: 'lands' }] })
    }
    await detectHighlights('key', 'model', transcript, { prompt: '', clipLength: 'auto', broll: false, hookFirst: false, videoType: 'auto' }, VIDEO)
    const request = captured.find((c) => c.schema === 'viral_clips')!
    const lines = request.user.split('\n').filter((l) => /^\[\d+\.\ds - \d+\.\ds\] /.test(l))
    expect(lines).toHaveLength(sentences.length)
    expect(lines[3]).toBe(`[${sentences[3].start.toFixed(1)}s - ${sentences[3].end.toFixed(1)}s] ${sentences[3].text}`)
  })

  it('lands mid-sentence model boundaries on sentence boundaries with pre- and post-roll', async () => {
    answers = {
      viral_clips: () => ({
        // 1 s into sentence 1, 0.5 s into sentence 5.
        clips: [raw(sentences[1].start + 1.0, sentences[5].start + 0.5, 80)]
      }),
      clip_endings: () => ({ endings: [{ index: 0, ends_with_payoff: true, better_end: 0, reason: 'lands' }] })
    }
    const [clip] = await detectHighlights('key', 'model', transcript, { prompt: '', clipLength: 'auto', broll: false, hookFirst: false, videoType: 'auto' }, VIDEO)
    expect(clip.suggestedStart).toBeCloseTo(sentences[1].start - 0.25, 5)
    expect(clip.suggestedEnd).toBeCloseTo(sentences[5].end + 0.6, 5)
    const report = analyzeClipBoundaries(transcript, clip.edit.start, clip.edit.end)
    expect(report.startsMidSentence).toBe(false)
    expect(report.endsMidSentence).toBe(false)
    expect(report.openingSentence).toBe(sentences[1].text)
    expect(report.closingSentence).toBe(sentences[5].text)
  })

  it('extends a clip whose ending the review judges as setup', async () => {
    answers = {
      viral_clips: () => ({ clips: [raw(sentences[2].start, sentences[6].end, 80)] }),
      clip_endings: () => ({
        endings: [{ index: 0, ends_with_payoff: false, better_end: sentences[7].end, reason: 'the payoff is the next line' }]
      })
    }
    const [clip] = await detectHighlights('key', 'model', transcript, { prompt: '', clipLength: 'auto', broll: false, hookFirst: false, videoType: 'auto' }, VIDEO)
    expect(clip.suggestedEnd).toBeCloseTo(sentences[7].end + 0.6, 5)
    // The review saw the closing sentences tagged with their real end times.
    const review = captured.find((c) => c.schema === 'clip_endings')!
    expect(review.user).toContain(`[ends ${sentences[6].end.toFixed(1)}s] ${sentences[6].text}`)
    expect(review.user).toContain(`[ends ${sentences[7].end.toFixed(1)}s] ${sentences[7].text}`)
  })

  it('advances a clip opening onto its hook sentence when asked to', async () => {
    answers = {
      viral_clips: () => ({ clips: [raw(sentences[1].start, sentences[8].end, 80)] }),
      clip_endings: () => ({ endings: [{ index: 0, ends_with_payoff: true, better_end: 0, reason: 'lands' }] }),
      clip_openings: () => ({
        starts: [{ index: 0, opens_with_hook: false, better_start: sentences[3].start, reason: 'throat clearing' }]
      })
    }
    const [clip] = await detectHighlights('key', 'model', transcript, { prompt: '', clipLength: 'auto', broll: false, hookFirst: true, videoType: 'auto' }, VIDEO)
    expect(clip.suggestedStart).toBeCloseTo(sentences[3].start - 0.25, 5)
    const review = captured.find((c) => c.schema === 'clip_openings')!
    expect(review.user).toContain(`[starts ${sentences[1].start.toFixed(1)}s] ${sentences[1].text}`)
  })

  it('drops near-duplicate moments and keeps clips inside the video', async () => {
    answers = {
      viral_clips: () => ({
        clips: [
          raw(sentences[1].start, sentences[5].end, 90, 'winner'),
          raw(sentences[2].start, sentences[5].end, 70, 'dupe'),
          raw(sentences[7].start, VIDEO + 40, 60, 'overruns')
        ]
      }),
      clip_endings: () => ({ endings: [] })
    }
    const clips = await detectHighlights('key', 'model', transcript, { prompt: '', clipLength: 'auto', broll: false, hookFirst: false, videoType: 'auto' }, VIDEO)
    expect(clips.map((c) => c.title)).toEqual(['winner', 'overruns'])
    expect(clips[1].suggestedEnd).toBeLessThanOrEqual(VIDEO)
  })
})
