import { randomUUID } from 'node:crypto'
import type {
  AnalyzeOptions,
  Clip,
  ClipLengthPreference,
  Transcript
} from '@shared/types'
import { DEFAULT_CAPTION_STYLE_ID } from '@shared/captionStyles'
import { normalizeClipEnd, sentenceEndTimes, sentenceStartTimes } from '@shared/sentences'
import { chatJSON } from './openai'

interface RawHighlight {
  start: number
  end: number
  title: string
  hook: string
  summary: string
  payoff: string
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
          'payoff',
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
          payoff: {
            type: 'string',
            description:
              'The closing line or idea the clip ends on and why it lands (resolution, punchline, answer, takeaway, or pointed question). A clip whose ending does not land should not be selected.'
          },
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

/**
 * Length is a preference, not a straitjacket. We give the model a target band
 * and a hard upper cap, but let it come in shorter when the moment is complete
 * — a self-contained 20s beat beats the same beat padded to 30s with trailing
 * filler. Platforms rank on completion rate, and padding a tight moment to hit
 * a number is the fastest way to tank it, so we never pad after the fact.
 */
function lengthGuidance(pref: ClipLengthPreference): string {
  switch (pref) {
    case 'short':
      return 'Aim for clips around 15-30 seconds long (end minus start). Never exceed 45 seconds. If a moment is complete in less time, keep it short rather than padding it.'
    case 'medium':
      return 'Aim for clips around 30-60 seconds long (end minus start). Never exceed 75 seconds. Favour the length the moment actually needs — do not pad a complete moment to fill the range.'
    case 'long':
      return 'Aim for clips around 60-90 seconds long (end minus start). Never exceed 100 seconds. Only reach the top of the range when the moment genuinely sustains it; do not pad with setup or tangents.'
    case 'auto':
      return 'Choose whatever length lets each moment land — anywhere from about 15 to 90 seconds (never exceed 100). Cut to the moment; do not pad it to reach a length.'
    default: {
      const exhaustive: never = pref
      return exhaustive
    }
  }
}

/** Hard upper cap per preference, enforced after the LLM responds. */
function maxDurationFor(pref: ClipLengthPreference): number {
  switch (pref) {
    case 'short':
      return 45
    case 'medium':
      return 75
    case 'long':
      return 100
    case 'auto':
      return 100
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

/** Breathing room added before the first word of a clip. */
const START_PRE_ROLL_SEC = 0.25
/** How far the clip start may move to land on a sentence beginning. */
const START_SNAP_SEC = 2.5
/**
 * Tail padding after the last word so endings land softly instead of cutting
 * the instant the word finishes (the export adds an audio fade inside it).
 */
const END_POST_ROLL_SEC = 0.6
/** How far the clip end may move to land on a sentence boundary. */
const SENTENCE_SNAP_SEC = 2.5

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
- Every clip MUST have the shape of a complete micro-video: a HOOK that grabs in the first sentence, a BUILD that develops or escalates it, and an ENDING THAT LANDS. A statement or observation on its own — however interesting — is not a clip.
- What "lands" depends on the material. A story lands on its resolution or emotional beat. Comedy lands on the punchline. An argument lands on its sharpest, most quotable formulation. A reveal lands on the answer. Practical content lands on the takeaway. A deliberately provocative clip can even land on a pointed question that throws back to the hook. All of these are valid endings.
- What never lands: trailing setup or scene-setting, context that introduces an idea and stops, the middle of a list, or an aside (ending right after "People were experimenting with ChatGPT for the first time" leaves the thought hanging — the sentence exists to set up whatever comes next). If the beat that completes the thought arrives one or two sentences after the moment you picked, extend the clip to include it.
- Every clip MUST start at the beginning of a sentence or thought and end at a natural conclusion. Never cut mid-sentence.
- Prefer moments with a strong hook in the first 3 seconds: bold claims, surprising facts, emotional peaks, controversy, humour, actionable value, or compelling storytelling.
- Clips must be self-contained: a viewer with zero context must understand them.
- Do not overlap clips. Order them by virality score, highest first.
- Use the transcript timestamps precisely; do not invent times outside the video.

Virality scoring rubric (0-99), grounded in sharing research (Berger & Milkman 2012: physiological arousal drives transmission; anger, awe and anxiety are the strongest predictors; sadness suppresses sharing; surprise and practical value independently boost it):
- Hook strength in the first sentence — curiosity gap, bold claim, or open question (0-30)
- High-arousal emotion — awe, amusement, excitement, anger, anxiety, surprise. Weight moments tagged [delivery: energetic] upward; a flat, deactivating or sad moment scores low here even if well-worded (0-25)
- Value — practical utility the viewer can apply, or novel insight that makes the sharer look smart (0-20)
- Structure — a clear hook -> build -> landing arc; a clip that is just a statement, or whose final sentence is setup rather than a landing, scores 0 here (0-15)
- Shareability — would someone tag a friend, argue in the comments, or repost to signal identity? (0-9)
Sum the parts for the final score. Be honest and discriminating: most clips score 40-75, reserve 85+ for exceptional moments.`

/**
 * How many clips to ask the LLM for: roughly one per minute of source video.
 * Exported for tests.
 */
export function targetClipCount(videoDurationSec: number): number {
  return Math.max(4, Math.min(40, Math.round(videoDurationSec / 60)))
}

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

/** How far the ending review may move a clip's end. */
const MAX_END_EXTEND_SEC = 45
const MAX_END_TRIM_SEC = 20
/** How much transcript beyond a clip's end the ending review gets to see. */
const CONTINUATION_SEC = 45

/**
 * How far the opening review may push a clip's start forward, i.e. the most
 * leading setup it may trim. Bounded so the review can only drop throat-
 * clearing, never lop off the body of a clip.
 */
const MAX_START_ADVANCE_SEC = 20

function withNormalizedEnd(clip: Clip, transcript: Transcript, videoDurationSec: number): Clip {
  const end = normalizeClipEnd(clip.suggestedStart, clip.suggestedEnd, transcript, videoDurationSec, {
    postRollSec: END_POST_ROLL_SEC,
    maxExtendSec: MAX_END_EXTEND_SEC
  })
  if (end === clip.suggestedEnd) return clip
  return { ...clip, suggestedEnd: end, edit: { ...clip.edit, end } }
}

const REFINE_SYSTEM_PROMPT = `You quality-check the ENDINGS of short vertical clips cut from a longer video. A good clip has the shape of a complete micro-video — hook, build, and an ending that lands. What "lands" depends on the material: a story lands on its resolution or emotional beat, comedy on the punchline, an argument on its sharpest formulation, a reveal on the answer, practical content on the takeaway, and a provocative clip can land on a pointed question that throws back to the hook. An ending fails when the clip stops on setup, scene-setting context, the middle of a list, or a plain observation that promises more (e.g. ending on "People were experimenting with ChatGPT for the first time" — that sentence exists to set up whatever comes next).

For each clip you receive its transcript and the sentences that follow it in the source video, each tagged with the time it ends. Judge the current ending strictly. A clip whose last spoken word lacks terminal punctuation (. ! ?) has not finished its sentence and must be extended. When an ending fails, pick the tagged sentence end-time where the thought completes — usually extending slightly to include the beat that follows, occasionally trimming back to an earlier, stronger closer. Only use end times that appear in the tags.`

interface RefinedEnding {
  index: number
  ends_with_payoff: boolean
  better_end: number
  reason: string
}

const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['endings'],
  properties: {
    endings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'ends_with_payoff', 'better_end', 'reason'],
        properties: {
          index: { type: 'integer', description: 'The clip number being judged' },
          ends_with_payoff: {
            type: 'boolean',
            description:
              'True when the current ending already lands (resolution, punchline, answer, takeaway, or pointed question)'
          },
          better_end: {
            type: 'number',
            description:
              'End time (seconds) of the sentence that completes the thought; repeat the current end when ends_with_payoff is true'
          },
          reason: { type: 'string', description: 'One short sentence justifying the verdict' }
        }
      }
    }
  }
} as const

/**
 * Clamp and snap an ending-review suggestion onto a sentence boundary, or
 * return the clip unchanged when the suggestion is a no-op or implausible.
 * Exported for tests.
 */
export function applyRefinedEnding(
  clip: Clip,
  betterEnd: number,
  sentenceEnds: number[],
  videoDurationSec: number
): Clip {
  if (!Number.isFinite(betterEnd)) return clip
  const snapped = snap(betterEnd, sentenceEnds, SENTENCE_SNAP_SEC)
  const newEnd = Math.min(videoDurationSec, snapped + END_POST_ROLL_SEC)
  const current = clip.suggestedEnd
  if (
    Math.abs(newEnd - current) < 1 ||
    newEnd > current + MAX_END_EXTEND_SEC ||
    newEnd < current - MAX_END_TRIM_SEC ||
    newEnd - clip.suggestedStart < MIN_CLIP_SEC
  ) {
    return clip
  }
  return { ...clip, suggestedEnd: newEnd, edit: { ...clip.edit, end: newEnd } }
}

/**
 * Second LLM pass over the candidate clips: verify each one ends on a beat
 * that lands and move the end to the sentence that completes the thought
 * when it does not. Selection quality problems concentrate at clip tails —
 * the first pass reliably finds hooks but often stops on setup. Failures
 * never break the pipeline; the unrefined clips are returned instead.
 */
async function refineClipEndings(
  apiKey: string,
  model: string,
  transcript: Transcript,
  clips: Clip[],
  videoDurationSec: number,
  signal?: AbortSignal
): Promise<Clip[]> {
  if (clips.length === 0) return clips
  const sentenceEnds = sentenceEndTimes(transcript)

  const blocks = clips.map((clip, i) => {
    const inClip = transcript.segments.filter(
      (s) => s.end > clip.suggestedStart + 0.2 && s.start < clip.suggestedEnd - 0.2
    )
    // Tag the closing sentences with end times; earlier text is context only.
    const tail = inClip.slice(-3)
    const head = inClip
      .slice(0, -3)
      .map((s) => s.text)
      .join(' ')
    const continuation = transcript.segments.filter(
      (s) => s.start >= clip.suggestedEnd - 0.5 && s.start < clip.suggestedEnd + CONTINUATION_SEC
    )
    return [
      `Clip ${i} — "${clip.title}" (currently ends at ${clip.suggestedEnd.toFixed(1)}s):`,
      head ? `  …${head.slice(-500)}` : '',
      ...tail.map((s) => `  [ends ${s.end.toFixed(1)}s] ${s.text}`),
      continuation.length > 0
        ? '  Continues after the current end:'
        : '  (the video ends here — extending is not possible)',
      ...continuation.map((s) => `  [ends ${s.end.toFixed(1)}s] ${s.text}`)
    ]
      .filter(Boolean)
      .join('\n')
  })

  try {
    const res = await chatJSON<{ endings: RefinedEnding[] }>(
      apiKey,
      model,
      [
        { role: 'system', content: REFINE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Judge the ending of each clip below. Return one entry per clip, in order.\n\n${blocks.join('\n\n')}`
        }
      ],
      'clip_endings',
      REFINE_SCHEMA as unknown as Record<string, unknown>,
      signal
    )

    const refined = [...clips]
    for (const entry of res.endings ?? []) {
      const clip = refined[entry.index]
      if (!clip || entry.ends_with_payoff) continue
      refined[entry.index] = applyRefinedEnding(clip, entry.better_end, sentenceEnds, videoDurationSec)
      if (process.env.CLIPFORGE_DEBUG && refined[entry.index] !== clip) {
        console.error(
          `[highlights] ending review moved clip ${entry.index} end ` +
            `${clip.suggestedEnd.toFixed(1)}s -> ${refined[entry.index].suggestedEnd.toFixed(1)}s: ${entry.reason}`
        )
      }
    }
    return refined.map((c) => withNormalizedEnd(c, transcript, videoDurationSec))
  } catch (err) {
    if (signal?.aborted) throw err
    // The candidates are still usable without the ending review.
    console.error('Clip ending review failed; keeping original endings:', err)
    return clips.map((c) => withNormalizedEnd(c, transcript, videoDurationSec))
  }
}

const REFINE_START_SYSTEM_PROMPT = `You quality-check the OPENINGS of short vertical clips cut from a longer video. The first 1-3 seconds decide whether a viewer keeps scrolling, so a clip must open on its HOOK — a bold claim, a surprising statement, a vivid moment, or a pointed question — not on throat-clearing, greetings, connective filler ("so", "and", "you know"), or setup whose only job is to lead into a later line.

For each clip you receive its intended hook and its opening sentences, each tagged with the time it starts. Judge the current opening strictly. If it already opens on the hook, say so. If it opens on skippable setup and the real hook is one of the later tagged sentences, return that sentence's start time so the dead opening is trimmed. Rules: only move the start FORWARD, only to a time that appears in the tags, and never trim so far that the hook loses the context a cold viewer needs to understand it. When in doubt, leave the opening where it is.`

interface RefinedStart {
  index: number
  opens_with_hook: boolean
  better_start: number
  reason: string
}

const REFINE_START_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['starts'],
  properties: {
    starts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'opens_with_hook', 'better_start', 'reason'],
        properties: {
          index: { type: 'integer', description: 'The clip number being judged' },
          opens_with_hook: {
            type: 'boolean',
            description: 'True when the clip already opens on its hook (no trimming needed)'
          },
          better_start: {
            type: 'number',
            description:
              'Start time (seconds) of the sentence where the hook begins; repeat the current start when opens_with_hook is true'
          },
          reason: { type: 'string', description: 'One short sentence justifying the verdict' }
        }
      }
    }
  }
} as const

/**
 * Clamp and snap an opening-review suggestion onto a sentence beginning, or
 * return the clip unchanged when the suggestion is a no-op, moves backwards,
 * reaches too far, or would leave too little clip. Only ever advances the
 * start (drops leading setup). Exported for tests.
 */
export function applyRefinedStart(clip: Clip, betterStart: number, sentenceStarts: number[]): Clip {
  if (!Number.isFinite(betterStart)) return clip
  const snapped = snap(betterStart, sentenceStarts, START_SNAP_SEC)
  const newStart = Math.max(0, snapped - START_PRE_ROLL_SEC)
  const current = clip.suggestedStart
  if (
    newStart <= current + 0.5 ||
    newStart > current + MAX_START_ADVANCE_SEC ||
    clip.suggestedEnd - newStart < MIN_CLIP_SEC
  ) {
    return clip
  }
  return { ...clip, suggestedStart: newStart, edit: { ...clip.edit, start: newStart } }
}

/**
 * Second LLM pass mirroring the ending review, but on clip OPENINGS: verify
 * each clip starts on its hook and push the start forward past leading setup
 * when it does not. The first pass reliably finds hooks but often opens on a
 * sentence or two of throat-clearing before them. Failures never break the
 * pipeline; the unrefined clips are returned instead.
 */
async function refineClipStarts(
  apiKey: string,
  model: string,
  transcript: Transcript,
  clips: Clip[],
  signal?: AbortSignal
): Promise<Clip[]> {
  if (clips.length === 0) return clips
  const sentenceStarts = sentenceStartTimes(transcript)

  const blocks = clips.map((clip, i) => {
    // Only the first stretch of the clip is eligible to be trimmed, so we show
    // just the opening sentences (plus a little slack) as candidates.
    const openWindowEnd = clip.suggestedStart + MAX_START_ADVANCE_SEC + 5
    const head = transcript.segments
      .filter((s) => s.end > clip.suggestedStart + 0.2 && s.start < openWindowEnd)
      .slice(0, 6)
    return [
      `Clip ${i} — intended hook: "${clip.hook || clip.title}" (currently starts at ${clip.suggestedStart.toFixed(1)}s):`,
      ...head.map((s) => `  [starts ${s.start.toFixed(1)}s] ${s.text}`)
    ].join('\n')
  })

  try {
    const res = await chatJSON<{ starts: RefinedStart[] }>(
      apiKey,
      model,
      [
        { role: 'system', content: REFINE_START_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Judge the opening of each clip below. Return one entry per clip, in order.\n\n${blocks.join('\n\n')}`
        }
      ],
      'clip_openings',
      REFINE_START_SCHEMA as unknown as Record<string, unknown>,
      signal
    )

    const refined = [...clips]
    for (const entry of res.starts ?? []) {
      const clip = refined[entry.index]
      if (!clip || entry.opens_with_hook) continue
      refined[entry.index] = applyRefinedStart(clip, entry.better_start, sentenceStarts)
      if (process.env.CLIPFORGE_DEBUG && refined[entry.index] !== clip) {
        console.error(
          `[highlights] opening review moved clip ${entry.index} start ` +
            `${clip.suggestedStart.toFixed(1)}s -> ${refined[entry.index].suggestedStart.toFixed(1)}s: ${entry.reason}`
        )
      }
    }
    return refined
  } catch (err) {
    if (signal?.aborted) throw err
    // The candidates are still usable without the opening review.
    console.error('Clip opening review failed; keeping original starts:', err)
    return clips
  }
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
  const clips =
    first.length > 0
      ? first
      : await requestHighlights(apiKey, model, transcript, options, videoDurationSec, true, signal)
  const refined = await refineClipEndings(apiKey, model, transcript, clips, videoDurationSec, signal)
  const trimmed = options.hookFirst
    ? await refineClipStarts(apiKey, model, transcript, refined, signal)
    : refined
  // Refinement can pull two clips onto the same landing beat; dedupe again.
  return dedupeClips(trimmed)
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

  const targetCount = targetClipCount(videoDurationSec)

  const userPrompt = [
    `Video duration: ${videoDurationSec.toFixed(1)} seconds.`,
    lengthGuidance(options.clipLength),
    insist
      ? 'You MUST return at least 3 clips. Even if no moment feels exceptional, select the 3 strongest available moments and score them honestly (low scores are fine). All timestamps are in seconds from the start of the video. Express "start" and "end" as plain seconds (e.g. 132.4).'
      : `Aim for about ${targetCount} clips spread across the whole video. Be generous: return every distinct moment strong enough to stand alone as a clip and let honest scores rank them — err on the side of more clips rather than fewer (at least ${Math.min(4, targetCount)}; fewer only if the material genuinely cannot support more). All timestamps are in seconds from the start of the video. Express "start" and "end" as plain seconds (e.g. 132.4).`,
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
  const sentenceStarts = sentenceStartTimes(transcript)
  const maxDur = maxDurationFor(options.clipLength)
  const normalizeEnd = (start: number, end: number): number =>
    normalizeClipEnd(start, end, transcript, videoDurationSec, {
      postRollSec: END_POST_ROLL_SEC,
      maxExtendSec: MAX_END_EXTEND_SEC
    })

  if (process.env.CLIPFORGE_DEBUG) {
    console.error('[highlights] raw LLM response:', JSON.stringify(res, null, 2))
  }

  const clips: Clip[] = []
  for (const raw of res.clips ?? []) {
    let start = Math.max(0, Math.min(raw.start, videoDurationSec - 1))
    let end = Math.max(start + 1, Math.min(raw.end, videoDurationSec))
    // Snap the start onto a sentence beginning so the clip opens on a clean
    // thought, not mid-sentence, then add a little pre-roll. Falls back to the
    // nearest word boundary when no sentence start is close enough.
    const sentenceStart = snap(start, sentenceStarts, START_SNAP_SEC)
    const snappedStart = sentenceStart !== start ? sentenceStart : snap(start, wordStarts, 1.5)
    start = Math.max(0, snappedStart - START_PRE_ROLL_SEC)
    // Rough word snap, then extend to the next punctuated sentence end when the
    // model (or Whisper segment boundary) stopped mid-thought.
    end = Math.min(videoDurationSec, snap(end, wordEnds, 1.5) + END_POST_ROLL_SEC)
    end = normalizeEnd(start, end)
    // Length is a preference, not a floor: we never pad a complete moment to
    // reach a target length (padding tanks completion rate). We only enforce
    // the hard upper cap, trimming an over-long clip back to the last sentence
    // that lands within the cap.
    if (end - start > maxDur) {
      const capTarget = start + maxDur
      const lastSentenceEnd = [...sentenceEndTimes(transcript)]
        .reverse()
        .find((e) => e + END_POST_ROLL_SEC <= capTarget && e > start + MIN_CLIP_SEC)
      end =
        lastSentenceEnd !== undefined
          ? Math.min(videoDurationSec, lastSentenceEnd + END_POST_ROLL_SEC)
          : capTarget
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
        autoZoom: true,
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
