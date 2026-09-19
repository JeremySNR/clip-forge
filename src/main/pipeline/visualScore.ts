import { readFile, rm, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Clip, Transcript } from '@shared/types'
import { wordsInRange } from '@shared/captionLayout'
import { computeKeptSegments, editedClipDuration, TimeMap } from '@shared/tighten'
import { chatJSON, type ChatContentPart } from './openai'
import { runFfmpeg } from './ffmpeg'

/**
 * Editorial review using six source frames and the selected transcript.
 * These scores are uncalibrated ranking estimates, not measured engagement.
 * Layout constraints are checked against actual proposed crops after tracking.
 */

/** Provisional text-pass weight; requires calibration against independent ratings. */
const TEXT_WEIGHT = 0.6

interface VisualAssessment {
  visual_score: number
  visual_summary: string
  preserve_context: boolean
  allow_zoom: boolean
  layout_reason: string
  needs_visual_payoff: boolean
  story_issue: { kind: string; evidence_quote: string; reason: string }
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['visual_score', 'visual_summary', 'preserve_context', 'allow_zoom', 'layout_reason', 'needs_visual_payoff', 'story_issue'],
  properties: {
    story_issue: {
      type: 'object', additionalProperties: false, required: ['kind', 'evidence_quote', 'reason'],
      properties: {
        kind: { type: 'string', enum: ['none', 'missing_essential_context', 'unresolved_ending', 'unrelated_scene'] },
        evidence_quote: { type: 'string', description: 'An exact 3–30 word excerpt demonstrating the failure; empty when kind is none' },
        reason: { type: 'string', description: 'What essential information or resolution the selected footage omits; empty when kind is none' }
      }
    },
    needs_visual_payoff: { type: 'boolean', description: 'True only when this clip introduces a forthcoming visual demonstration, experiment, performance or result that has not yet been shown. A complete spoken anecdote or explanation does not require illustrative footage.' },
    preserve_context: { type: 'boolean', description: 'True when a face-centered portrait crop risks losing essential objects, hands, text, screen UI, action or relationships between subjects' },
    allow_zoom: { type: 'boolean', description: 'True only when additional zoom has ample headroom and cannot remove relevant content in any sampled frame' },
    layout_reason: { type: 'string', description: 'Name the content that must remain visible and the reason for the layout constraint' },
    visual_score: {
      type: 'integer',
      description: 'Visual engagement potential 0-99 using the rubric'
    },
    visual_summary: {
      type: 'string',
      description: 'One short sentence on what the visuals add or cost, written for the creator'
    }
  }
} as const

const SYSTEM_PROMPT = `You assess a candidate short video from six SOURCE frames and its actual transcript. These are not the final rendered crop. Return an editorial estimate, not a claim of measured popularity.

You are not given the generated title, intended hook, prior score or omitted source. Judge only what a new viewer actually receives. Flag story_issue only for a concrete failure: essential context never supplied by speech or visible action, an unresolved exchange ending without a payoff, or an unrelated scene appended to an incomplete thought. Quote the actual spoken evidence. A conversational opening, unknown personal name, ordinary pronoun, missing biography, static shot or unexciting topic is NOT by itself a coherence failure. Visual objects can supply context. An intentionally pointed question can land if it completes the argument; an unanswered question to another participant does not. A plain introduction to a forthcoming demonstration should use needs_visual_payoff so the pipeline can inspect and repair it. Do not invent unseen action between samples.

Score 0-99 considering:
- Opening clarity and interest (0-25): judge the actual opening, not the generated title.
- Visual evidence and payoff (0-30): are the demonstrated object, action or result actually included? An introduction promising a later unseen demonstration is incomplete.
- Standalone coherence (0-20): can a new viewer understand the point without omitted scenes or questions?
- Watchability and legibility (0-15): lighting, framing, readable controls/text, purposeful pacing.
- Expressiveness or useful visual detail (0-9): relevant reactions, gestures, objects or demonstrations. A static explanation or useful screen demonstration can score well without a face.

Set needs_visual_payoff=true if the clip promises or introduces a forthcoming visual demonstration/performance/result but only contains its introduction or still preview. We can inspect the following footage to repair this. Do not mark complete spoken anecdotes, arguments or explanations as missing merely because no illustrative object or B-roll appears. Do not invent unseen action between samples.

Also assess layout safety. A face-centered 9:16 crop from a wide source discards most of the horizontal image. Set preserve_context=true for screens, question slates, slides, presenter insets beside content, hands-on demonstrations, significant props, or cinematic/action scenes whose meaning needs a wider composition. A visible face is not permission to remove the subject of the video. If any sampled shot needs that context, preserve it for this clip. Do not request context preservation solely because a conventional interview contains two people. Set allow_zoom=false for tight close-ups, limited headroom or uncertain containment. Explain what needs protection.`

/** Extract N sample frames as small JPEGs; returns their paths. */
export function clipFrameTimes(startSec: number, endSec: number, count: number): number[] {
  const duration = Math.max(0.1, endSec - startSec)
  const first = Math.min(0.25, duration * 0.05)
  const last = duration - Math.min(0.15, duration * 0.05)
  return Array.from({ length: count }, (_, i) => startSec +
    (count === 1 ? first : first + ((last - first) * i) / (count - 1)))
}

export async function extractClipFrames(
  videoPath: string,
  startSec: number,
  endSec: number,
  count = 3,
  signal?: AbortSignal,
  maxWidth = 512
): Promise<string[]> {
  return extractFramesAtTimes(videoPath, clipFrameTimes(startSec, endSec, count), signal, maxWidth)
}

export async function extractFramesAtTimes(videoPath: string, times: number[], signal?: AbortSignal, maxWidth = 512): Promise<string[]> {
  if (!times.length) return []
  const dir = join(tmpdir(), 'clipforge', `vframes-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  const paths: string[] = []
  try {
    for (const [i, t] of times.entries()) {
      signal?.throwIfAborted()
      // Hook frame slightly inside the clip; then spread across it.
      const out = join(dir, `f${i}.jpg`)
      // FFmpeg can exit successfully without writing a frame when the seek
      // lands after the last timestamp of a low-FPS clip. Step back until a
      // real frame exists instead of failing the whole visual review later.
      let extracted = false
      for (const seek of new Set([t, t - 0.25, t - 0.5, t - 1].map(value => Math.max(0, value)))) {
        signal?.throwIfAborted()
        await rm(out, { force: true })
        await runFfmpeg([
          '-ss', seek.toFixed(3),
          '-i', videoPath,
          '-frames:v', '1',
          '-vf', `scale='min(${Math.max(128, Math.min(1920, Math.round(maxWidth)))},iw)':-2`,
          '-q:v', '6',
          out
        ], { signal })
        if (await stat(out).then(file => file.size > 0).catch(() => false)) {
          extracted = true
          break
        }
      }
      if (!extracted) throw new Error(`Could not extract a frame near ${t.toFixed(3)}s`)
      paths.push(out)
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return paths
}

async function frameToDataUrl(path: string): Promise<string> {
  const bytes = await readFile(path)
  return `data:image/jpeg;base64,${bytes.toString('base64')}`
}

export interface VisualScoreResult {
  visualScore: number
  visualSummary: string
  visualLayout: NonNullable<Clip['visualLayout']>
  needsVisualPayoff: boolean
  storyIssue?: StoryIssue
}

export interface StoryIssue {
  kind: 'missing_essential_context' | 'unresolved_ending' | 'unrelated_scene'
  evidenceQuote: string
  reason: string
}

/** Ground a rejecting verdict in the supplied speech. This does not prove the
 * interpretation correct, but prevents invented titles/quotes from rejecting a clip. */
export function validatedStoryIssue(value: unknown, transcriptText: string): StoryIssue | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (!['missing_essential_context', 'unresolved_ending', 'unrelated_scene'].includes(String(v.kind)) ||
      typeof v.evidence_quote !== 'string' || typeof v.reason !== 'string' || !v.reason.trim()) return undefined
  const normalize = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const quote = normalize(v.evidence_quote)
  const count = quote.split(' ').length
  if (count < 3 || count > 30 || !` ${normalize(transcriptText)} `.includes(` ${quote} `)) return undefined
  return { kind: v.kind as StoryIssue['kind'], evidenceQuote: v.evidence_quote.trim(), reason: v.reason.trim() }
}

/** Sample the planned edit, so removed waiting time cannot masquerade as payoff. */
export function plannedClipFrameTimes(clip: Clip, transcript: Transcript, count = 6): number[] {
  const ranges = clip.edit.tightenCuts
    ? computeKeptSegments(transcript, clip.edit.start, clip.edit.end, clip.visualStory?.protectedRanges)
    : null
  if (!ranges) return clipFrameTimes(clip.edit.start, clip.edit.end, count)
  const map = new TimeMap(ranges)
  return clipFrameTimes(0, map.outputDuration, count).map(t => map.toSource(t))
}

/** Supply the same retained speech as the export, not words inside cut gaps. */
export function plannedClipTranscriptText(clip: Clip, transcript: Transcript): string {
  const kept = clip.edit.tightenCuts
    ? computeKeptSegments(transcript, clip.edit.start, clip.edit.end, clip.visualStory?.protectedRanges)
    : null
  return wordsInRange(transcript, clip.edit.start, clip.edit.end)
    .filter(w => !kept || kept.some(r => (w.start + w.end) / 2 >= r.start && (w.start + w.end) / 2 <= r.end))
    .map(w => w.text).join(' ')
}

export async function assessClipVisuals(
  apiKey: string,
  model: string,
  videoPath: string,
  transcript: Transcript,
  clip: Clip,
  signal?: AbortSignal
): Promise<VisualScoreResult | null> {
  let framePaths: string[] = []
  try {
    framePaths = await extractFramesAtTimes(videoPath, plannedClipFrameTimes(clip, transcript), signal)
    const excerpt = plannedClipTranscriptText(clip, transcript).slice(0, 6000)

    const parts: ChatContentPart[] = [
      {
        type: 'text',
        text: `Selected footage (${editedClipDuration(clip, transcript).toFixed(1)}s edited playback). Transcript: "${excerpt}"\n\nSix source frames from the planned edit follow in chronological order. Evaluate what is actually included, and what a vertical crop must preserve.`
      }
    ]
    for (const p of framePaths) {
      parts.push({ type: 'image_url', image_url: { url: await frameToDataUrl(p), detail: 'low' } })
    }

    const res = await chatJSON<VisualAssessment>(
      apiKey,
      model,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: parts }
      ],
      'visual_assessment',
      RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      signal
    )
    return {
      needsVisualPayoff: res.needs_visual_payoff === true,
      storyIssue: validatedStoryIssue(res.story_issue, excerpt),
      visualScore: Math.max(0, Math.min(99, Math.round(res.visual_score))),
      visualSummary: res.visual_summary,
      visualLayout: {
        start: clip.edit.start, end: clip.edit.end,
        preserveContext: res.preserve_context === true,
        allowZoom: res.allow_zoom === true,
        reason: typeof res.layout_reason === 'string' ? res.layout_reason : ''
      }
    }
  } catch (err) {
    if (signal?.aborted) throw err
    console.error('Visual scoring failed for clip (keeping text score):', err)
    return null
  } finally {
    if (framePaths.length > 0) {
      await rm(join(framePaths[0], '..'), { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/** Blend two provisional editorial estimates; this is not measured engagement. */
export function ensembleScore(textScore: number, visualScore: number): number {
  return Math.max(0, Math.min(99, Math.round(TEXT_WEIGHT * textScore + (1 - TEXT_WEIGHT) * visualScore)))
}
