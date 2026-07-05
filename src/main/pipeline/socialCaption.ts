import type { Clip, Transcript } from '@shared/types'
import { wordsInRange } from '@shared/captionLayout'
import { chatJSON } from './openai'

/**
 * Generates a ready-to-paste TikTok-style post caption for a clip. The
 * guidance encodes what reliably performs on short-form platforms: a short
 * curiosity-driving first line (captions truncate after ~1 line in feed), a
 * comment bait or CTA, and a handful of niche hashtags rather than generic
 * spam. Kept separate from the burned-in captions (those are subtitles).
 */

const SYSTEM_PROMPT = `You write post captions for short vertical videos (TikTok, Reels, Shorts). You receive one clip's content and return a single caption that maximises engagement.

Rules for a high-performing caption:
- First line is a hook: a curiosity gap, bold claim or relatable pain point in under 12 words. It must survive feed truncation — front-load the intrigue. Do not repeat the video's on-screen hook word-for-word; complement it.
- Keep the whole caption under 150 characters before hashtags. Short outperforms long.
- Add ONE engagement driver: a question that invites comments, a "tag someone who…", or a save/share nudge — whichever genuinely fits the content. Never stack several.
- Finish with 3-5 hashtags on the same caption: 2-3 niche/topical tags that match the content, at most 1 broad tag. No #fyp #viral #foryou spam — those are dead weight.
- Match the speaker's tone (funny stays funny, serious stays serious). No emoji walls: 0-2 emoji max, only where they add meaning.
- Never invent facts that are not in the clip.`

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
      description: 'The complete post caption including hashtags, ready to paste'
    }
  }
} as const

export async function generateSocialCaption(
  apiKey: string,
  model: string,
  clip: Clip,
  transcript: Transcript | null,
  signal?: AbortSignal
): Promise<string> {
  const excerpt = transcript
    ? wordsInRange(transcript, clip.edit.start, clip.edit.end)
        .map((w) => w.text)
        .join(' ')
        .slice(0, 1800)
    : ''

  const userPrompt = [
    `Clip title: "${clip.title}"`,
    clip.hook ? `On-screen hook: "${clip.hook}"` : '',
    clip.summary ? `Summary: ${clip.summary}` : '',
    clip.hashtags.length > 0 ? `Suggested topic tags: ${clip.hashtags.join(', ')}` : '',
    excerpt ? `Transcript of the clip:\n"${excerpt}"` : '',
    'Write the caption.'
  ]
    .filter(Boolean)
    .join('\n\n')

  const res = await chatJSON<CaptionResponse>(
    apiKey,
    model,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    'post_caption',
    RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    signal
  )
  const caption = res.caption?.trim()
  if (!caption) throw new Error('Caption generation returned an empty result')
  return caption
}
