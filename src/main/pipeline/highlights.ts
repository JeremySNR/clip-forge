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
      return 'Each clip should be 15-30 seconds long.'
    case 'medium':
      return 'Each clip should be 30-60 seconds long.'
    case 'long':
      return 'Each clip should be 60-90 seconds long.'
    case 'auto':
      return 'Each clip should be 20-90 seconds long; choose whatever length lets the moment breathe.'
    default: {
      const exhaustive: never = pref
      return exhaustive
    }
  }
}

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

const SYSTEM_PROMPT = `You are an expert short-form video editor who has studied thousands of viral TikToks, Reels and Shorts. You receive the timestamped transcript of a long video and must select the moments most likely to go viral as standalone vertical clips.

Selection rules:
- Every clip MUST start at the beginning of a sentence or thought and end at a natural conclusion. Never cut mid-sentence.
- Prefer moments with a strong hook in the first 3 seconds: bold claims, surprising facts, emotional peaks, controversy, humour, actionable value, or compelling storytelling.
- Clips must be self-contained: a viewer with zero context must understand them.
- Do not overlap clips. Order them by virality score, highest first.
- Use the transcript timestamps precisely; do not invent times outside the video.

Virality scoring rubric (0-99):
- Hook strength in the first sentence (0-30)
- Emotional impact or surprise (0-25)
- Value/insight density (0-20)
- Completeness as a standalone story (0-15)
- Shareability / discussion potential (0-9)
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

export async function detectHighlights(
  apiKey: string,
  model: string,
  transcript: Transcript,
  options: AnalyzeOptions,
  videoDurationSec: number
): Promise<Clip[]> {
  const transcriptText = transcript.segments
    .map((s) => `[${formatTimestamp(s.start)} - ${formatTimestamp(s.end)}] ${s.text}`)
    .join('\n')

  const targetCount = Math.max(3, Math.min(12, Math.round(videoDurationSec / 240)))

  const userPrompt = [
    `Video duration: ${formatTimestamp(videoDurationSec)} (${videoDurationSec.toFixed(1)} seconds).`,
    lengthGuidance(options.clipLength),
    `Return between 3 and ${Math.max(targetCount, 5)} clips (fewer if the material genuinely does not support more). All timestamps are in seconds from the start of the video. Express "start" and "end" as plain seconds (e.g. 132.4).`,
    options.prompt.trim()
      ? `The creator gave these special instructions, which take priority when choosing moments: "${options.prompt.trim()}"`
      : '',
    'Transcript (each line prefixed with [start - end] in m:ss.s):',
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
    RESPONSE_SCHEMA as unknown as Record<string, unknown>
  )

  const wordStarts: number[] = []
  const wordEnds: number[] = []
  for (const seg of transcript.segments) {
    for (const w of seg.words) {
      wordStarts.push(w.start)
      wordEnds.push(w.end)
    }
  }

  const clips: Clip[] = []
  for (const raw of res.clips ?? []) {
    let start = Math.max(0, Math.min(raw.start, videoDurationSec - 1))
    let end = Math.max(start + 1, Math.min(raw.end, videoDurationSec))
    // Snap to word boundaries for clean cuts, with a little pre/post roll.
    start = Math.max(0, snap(start, wordStarts, 1.5) - 0.25)
    end = Math.min(videoDurationSec, snap(end, wordEnds, 1.5) + 0.45)
    if (end - start < 3) continue
    clips.push({
      id: randomUUID(),
      suggestedStart: start,
      suggestedEnd: end,
      title: raw.title,
      hook: raw.hook,
      summary: raw.summary,
      viralityScore: Math.max(0, Math.min(99, Math.round(raw.virality_score))),
      viralityReason: raw.virality_reason,
      hashtags: (raw.hashtags ?? []).map((h) => h.replace(/^#/, '').toLowerCase()),
      thumbnailPath: null,
      focusTrack: null,
      edit: {
        aspect: '9:16',
        reframeMode: 'crop',
        framing: 'manual',
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
  return clips
}
