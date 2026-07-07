import type { BrandVoiceSettings, Clip, Transcript } from '@shared/types'
import { wordsInRange } from '@shared/captionLayout'
import { chatJSON } from './openai'

/**
 * Generates a caption for posting a clip to WorkVivo — an internal employee
 * experience platform, not a public social feed. The register is colleague-to-
 * colleague: warm, clear, and free of the hashtag spam and growth hooks that
 * suit TikTok. Kept separate from `generateSocialCaption` for exactly that
 * reason. Brand voice settings (name/tone/style/avoid) steer it so captions
 * sound like the organisation rather than generic AI copy.
 */

const BASE_SYSTEM_PROMPT = `You write post captions for WorkVivo, an internal employee communications platform (a company's private social feed). Your caption introduces a short video to colleagues.

Rules:
- Write for an internal audience of coworkers, not the public. Warm, human and clear.
- 1-3 short sentences. Lead with what the video is and why a colleague would want to watch it.
- No hashtags. No emoji spam (0-1 emoji at most, only if it genuinely fits). No clickbait hooks, no "link in bio", no growth-hacking tricks.
- Never invent facts, names or figures that are not in the clip.
- If a house brand voice is provided, follow it exactly. Otherwise default to British English in a friendly, professional voice.`

function brandVoiceLines(voice: BrandVoiceSettings): string {
  const lines: string[] = []
  if (voice.brandName.trim()) lines.push(`Brand/organisation name: ${voice.brandName.trim()}`)
  if (voice.tone.trim()) lines.push(`Tone of voice: ${voice.tone.trim()}`)
  if (voice.style.trim()) lines.push(`Writing style: ${voice.style.trim()}`)
  if (voice.avoid.trim()) lines.push(`Avoid: ${voice.avoid.trim()}`)
  return lines.join('\n')
}

interface CaptionResponse {
  caption: string
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['caption'],
  properties: {
    caption: {
      type: 'string',
      description: 'The complete WorkVivo post caption, ready to post'
    }
  }
} as const

export async function generateWorkvivoCaption(
  apiKey: string,
  model: string,
  clip: Clip,
  transcript: Transcript | null,
  voice: BrandVoiceSettings,
  signal?: AbortSignal
): Promise<string> {
  const excerpt = transcript
    ? wordsInRange(transcript, clip.edit.start, clip.edit.end)
        .map((w) => w.text)
        .join(' ')
        .slice(0, 1800)
    : ''

  const brand = brandVoiceLines(voice)
  const systemPrompt = brand
    ? `${BASE_SYSTEM_PROMPT}\n\nHouse brand voice (follow this):\n${brand}`
    : BASE_SYSTEM_PROMPT

  const userPrompt = [
    `Clip title: "${clip.title}"`,
    clip.hook ? `On-screen hook: "${clip.hook}"` : '',
    clip.summary ? `Summary: ${clip.summary}` : '',
    excerpt ? `Transcript of the clip:\n"${excerpt}"` : '',
    'Write the WorkVivo caption.'
  ]
    .filter(Boolean)
    .join('\n\n')

  const res = await chatJSON<CaptionResponse>(
    apiKey,
    model,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    'workvivo_caption',
    RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signal
  )
  const caption = res.caption?.trim()
  if (!caption) throw new Error('Caption generation returned an empty result')
  return caption
}
