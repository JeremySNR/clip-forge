import { randomUUID } from 'node:crypto'
import type {
  AnalyzeOptions,
  Clip,
  ClipLengthPreference,
  Transcript
} from '@shared/types'
import { DEFAULT_CAPTION_STYLE_ID } from '@shared/captionStyles'
import { chatJSON } from './openai'

interface RawHighlight {
  start: number
  end: number
  title: string
  hook: string
  summary: string
  virality_score: number
  virality_reason: string
  hashtags: string[]
}

interface HighlightResponse {
  clips: RawHighlight[]
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clips'],
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'start',
          'end',
          'title',
          'hook',
          'summary',
          'virality_score',
          'virality_reason',
          'hashtags'
        ],
        properties: {
          start: { type: 'number', description: 'Clip start time in seconds' },
          end: { type: 'number', description: 'Clip end time in seconds' },
          title: {
            type: 'string',
            description: 'Punchy social-media title, max 60 characters, no hashtags'
          },
          hook: {
            type: 'string',
            description: 'Scroll-stopping first line to overlay during the first seconds'
          },
          summary: { type: 'string', description: 'One sentence describing the moment' },
          virality_score: {
            type: 'integer',
            description: 'Predicted engagement 0-99 using the scoring rubric'
          },
          virality_reason: {
            type: 'string',
            description: 'Short explanation of the score citing hook/emotion/value'
          },
          hashtags: {
            type: 'array',
            items: { type: 'string' },
            description: '3-5 lowercase hashtags without the # symbol'
          }
        }
      }
    }
  }
} as const

function lengthGuidance(pref: ClipLengthPreference): string {
  switch (pref) {
    case 'short':
      return 'Each clip MUST be between 15 and 30 seconds long (end minus start).'
    case 'medium':
      return 'Each clip MUST be between 30 and 60 seconds long (end minus start).'
    case 'long':
      return 'Each clip MUST be between 60 and 90 seconds long (end minus start).'
    case 'auto':
      return 'Each clip MUST be between 15 and 90 seconds long (end minus start); choose whatever length lets the moment breathe.'
    default: {
      const exhaustive: never = pref
      return exhaustive
    }
  }
}

/**
 * Plain seconds, not m:ss — models reliably echo the same unit back, whereas
 * "5:30" style timestamps get misread as 5.5 seconds on long videos.
 */
function formatTimestamp(sec: number): string {
  return `${sec.toFixed(1)}s`
}

const MIN_CLIP_SEC = 8

/** Hard floor per length preference, enforced after the LLM responds. */
function minDurationFor(pref: ClipLengthPreference): number {
  switch (pref) {
    case 'short':
      return 15
    case 'medium':
      return 30
    case 'long':
      return 60
    case 'auto':
      return 15
    default: {
      const exhaustive: never = pref
      return exhaustive
    }
  }
}

/**
 * The scoring rubric operationalises published virality research rather than
 * vibes — primarily Berger & Milkman, "What Makes Online Content Viral?"
 * (Journal of Marketing Research, 2012): sharing is driven by physiological
 * AROUSAL. High-arousal emotions (awe, amusement/humour, excitement, anger,
 * anxiety) increase transmission; low-arousal/deactivating emotions (sadness)
 * decrease it, independent of positive/negative valence. Surprise, interest
 * and practical utility are independently positively linked to sharing, and
 * anger was the single strongest predictor in their model. Berger (2011,
 * Psychological Science) shows induced arousal alone increases sharing.
 */
const SYSTEM_PROMPT = `You are an expert short-form video editor who selects moments most likely to go viral as standalone vertical clips. You receive the timestamped transcript of a long video. Some lines carry a [delivery: ...] tag measured from the actual audio — "energetic" marks the speaker's most aroused, animated delivery, "subdued" the flattest.

Selection rules:
- Every clip MUST start at the beginning of a sentence or thought and end at a natural conclusion. Never cut mid-sentence.
- Prefer moments with a strong hook in the first 3 seconds: bold claims, surprising facts, emotional peaks, controversy, humour, actionable value, or compelling storytelling.
- Clips must be self-contained: a viewer with zero context must understand them.
- Do not overlap clips. Order them by virality score, highest first.
- Use the transcript timestamps precisely; do not invent times outside the video.

Virality scoring rubric (0-99), grounded in sharing research (Berger & Milkman 2012: physiological arousal drives transmission; anger, awe and anxiety are the strongest predictors; sadness suppresses sharing; surprise and practical value independently boost it):
- Hook strength in the first sentence — curiosity gap, bold claim, or open question (0-30)
- High-arousal emotion — awe, amusement, excitement, anger, anxiety, surprise. Weight moments tagged [delivery: energetic] upward; a flat, deactivating or sad moment scores low here even if well-worded (0-25)
- Value — practical utility the viewer can apply, or novel insight that makes the sharer look smart (0-20)
- Completeness as a standalone story (0-15)
- Shareability — would someone tag a friend, argue in the comments, or repost to signal identity? (0-9)
Sum the parts for the final score. Be honest and discriminating: most clips score 40-75, reserve 85+ for exceptional moments.`

/** Snap a time to the nearest transcript word boundary within a tolerance. */
function snap(time: number, boundaries: number[], toleranceSec: number): number {
  let best = time
  let bestDist = toleranceSec
  for (const b of boundaries) {
    const d = Math.abs(b - time)
    if (d < bestDist) {
      best = b
      bestDist = d
    }
  }
  return best
}

/**
 * Drop clips that substantially overlap a higher-scored clip, so the results
 * grid never shows two near-identical moments. Input must be sorted by score
 * descending. Exported for tests.
 */
export function dedupeClips(clips: Clip[], maxOverlapFraction = 0.4): Clip[] {
  const kept: Clip[] = []
  for (const clip of clips) {
    const dur = clip.suggestedEnd - clip.suggestedStart
    const tooSimilar = kept.some((k) => {
      const overlap =
        Math.min(clip.suggestedEnd, k.suggestedEnd) - Math.max(clip.suggestedStart, k.suggestedStart)
      if (overlap <= 0) return false
      const kDur = k.suggestedEnd - k.suggestedStart
      return overlap / Math.min(dur, kDur) > maxOverlapFraction
    })
    if (!tooSimilar) kept.push(clip)
  }
  return kept
}

export async function detectHighlights(
  apiKey: string,
  model: string,
  transcript: Transcript,
  options: AnalyzeOptions,
  videoDurationSec: number,
  signal?: AbortSignal
): Promise<Clip[]> {
  // LLM output is nondeterministic: occasionally it returns an empty list on
  // perfectly clippable material, so retry once with a firmer instruction.
  const first = await requestHighlights(apiKey, model, transcript, options, videoDurationSec, false, signal)
  if (first.length > 0) return first
  return requestHighlights(apiKey, model, transcript, options, videoDurationSec, true, signal)
}

async function requestHighlights(
  apiKey: string,
  model: string,
  transcript: Transcript,
  options: AnalyzeOptions,
  videoDurationSec: number,
  insist: boolean,
  signal?: AbortSignal
): Promise<Clip[]> {
  const transcriptText = transcript.segments
    .map((s) => {
      const delivery =
        s.energy === undefined
          ? ''
          : s.energy >= 0.8
            ? ' [delivery: energetic]'
            : s.energy <= 0.2
              ? ' [delivery: subdued]'
              : ''
      return `[${formatTimestamp(s.start)} - ${formatTimestamp(s.end)}] ${s.text}${delivery}`
    })
    .join('\n')

  const targetCount = Math.max(3, Math.min(12, Math.round(videoDurationSec / 240)))

  const userPrompt = [
    `Video duration: ${videoDurationSec.toFixed(1)} seconds.`,
    lengthGuidance(options.clipLength),
    insist
      ? 'You MUST return at least 3 clips. Even if no moment feels exceptional, select the 3 strongest available moments and score them honestly (low scores are fine). All timestamps are in seconds from the start of the video. Express "start" and "end" as plain seconds (e.g. 132.4).'
      : `Aim for ${Math.max(targetCount, 4)} clips spread across the whole video (at least 3; fewer only if the material genuinely cannot support more). All timestamps are in seconds from the start of the video. Express "start" and "end" as plain seconds (e.g. 132.4).`,
    options.prompt.trim()
      ? `The creator gave these special instructions, which take priority when choosing moments: "${options.prompt.trim()}"`
      : '',
    'Transcript (each line prefixed with [start - end] in seconds from the start of the video):',
    transcriptText
  ]
    .filter(Boolean)
    .join('\n\n')

  const res = await chatJSON<HighlightResponse>(
    apiKey,
    model,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    'viral_clips',
    RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signal
  )

  const wordStarts: number[] = []
  const wordEnds: number[] = []
  for (const seg of transcript.segments) {
    for (const w of seg.words) {
      wordStarts.push(w.start)
      wordEnds.push(w.end)
    }
  }
  const segmentEnds = transcript.segments.map((s) => s.end).sort((a, b) => a - b)
  const minDur = minDurationFor(options.clipLength)

  if (process.env.CLIPFORGE_DEBUG) {
    console.error('[highlights] raw LLM response:', JSON.stringify(res, null, 2))
  }

  const clips: Clip[] = []
  for (const raw of res.clips ?? []) {
    let start = Math.max(0, Math.min(raw.start, videoDurationSec - 1))
    let end = Math.max(start + 1, Math.min(raw.end, videoDurationSec))
    // Snap to word boundaries for clean cuts, with a little pre/post roll.
    start = Math.max(0, snap(start, wordStarts, 1.5) - 0.25)
    end = Math.min(videoDurationSec, snap(end, wordEnds, 1.5) + 0.45)
    // Models often under-shoot durations: extend short clips to the next
    // sentence boundary that satisfies the length preference — or to the end
    // of the video when no sentence boundary is late enough.
    if (end - start < minDur) {
      const targetEnd = start + minDur
      const nextSentenceEnd = segmentEnds.find((e) => e >= targetEnd)
      end = Math.min(videoDurationSec, (nextSentenceEnd ?? targetEnd) + 0.45)
    }
    if (end - start < Math.min(MIN_CLIP_SEC, videoDurationSec * 0.5)) {
      if (process.env.CLIPFORGE_DEBUG) {
        console.error(`[highlights] dropped too-short clip ${raw.start}-${raw.end} -> ${start.toFixed(1)}-${end.toFixed(1)}`)
      }
      continue
    }
    clips.push({
      id: randomUUID(),
      suggestedStart: start,
      suggestedEnd: end,
      title: raw.title,
      hook: raw.hook,
      summary: raw.summary,
      viralityScore: Math.max(0, Math.min(99, Math.round(raw.virality_score))),
      viralityReason: raw.virality_reason,
      visualSummary: null,
      hashtags: (raw.hashtags ?? []).map((h) => h.replace(/^#/, '').toLowerCase()),
      thumbnailPath: null,
      focusTrack: null,
      broll: [],
      edit: {
        aspect: '9:16',
        reframeMode: 'crop',
        framing: 'manual',
        tightenCuts: true,
        focusX: 0.5,
        captionsEnabled: true,
        captionStyleId: DEFAULT_CAPTION_STYLE_ID,
        showTitle: false,
        start,
        end
      }
    })
  }

  clips.sort((a, b) => b.viralityScore - a.viralityScore)
  return dedupeClips(clips)
}
