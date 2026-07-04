import { readFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Clip, Transcript } from '@shared/types'
import { wordsInRange } from '@shared/captionLayout'
import { chatJSON, type ChatContentPart } from './openai'
import { runFfmpeg } from './ffmpeg'

/**
 * Visual virality rescoring, implementing the method of Kayal et al.,
 * "Large Language Models Are Natural Video Popularity Predictors" (Findings
 * of ACL 2025): LLMs given frame-level visual content alongside text predict
 * video popularity better than supervised content-embedding models (82% vs
 * 80% zero-shot; 85.5% combined), with interpretable explanations. We feed
 * the model three frames per candidate clip (hook, middle, end) plus the
 * transcript, then ensemble the visual score with the text-pass score.
 */

/** Weight of the text-pass score in the final ensemble (paper combines both). */
const TEXT_WEIGHT = 0.6

interface VisualAssessment {
  visual_score: number
  visual_summary: string
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['visual_score', 'visual_summary'],
  properties: {
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

const SYSTEM_PROMPT = `You assess the VISUAL virality potential of a short vertical clip from three frames (start/hook moment, middle, end) plus its transcript. Research shows frame-level visual context materially changes popularity predictions versus text alone.

Score 0-99 considering:
- Hook frame (0-30): would the first frame stop a scroll? Faces, expressions, motion, intrigue beat static wide shots and slides.
- Human presence & expressiveness (0-25): visible faces, emotion, gestures, eye contact.
- Visual dynamism & variety (0-20): do the frames differ (movement, cuts, action) or is it one static shot throughout?
- Production watchability (0-15): framing, lighting, legibility; penalise unwatchably dark/blurry/cluttered frames.
- Content-visual match (0-9): do the visuals support what is being said?

Be honest: a static talking head with decent lighting typically lands 45-65; a slide/screen recording with no face lower; expressive faces with movement and scene variety higher.`

/** Extract N sample frames as small JPEGs; returns their paths. */
export async function extractClipFrames(
  videoPath: string,
  startSec: number,
  endSec: number,
  count = 3
): Promise<string[]> {
  const dir = join(tmpdir(), 'clipforge', `vframes-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  const duration = Math.max(0.1, endSec - startSec)
  const paths: string[] = []
  for (let i = 0; i < count; i++) {
    // Hook frame slightly inside the clip; then spread across it.
    const t = startSec + duration * (count === 1 ? 0.1 : 0.08 + (0.84 * i) / (count - 1))
    const out = join(dir, `f${i}.jpg`)
    await runFfmpeg([
      '-ss', t.toFixed(3),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', "scale='min(512,iw)':-2",
      '-q:v', '6',
      out
    ])
    paths.push(out)
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
    framePaths = await extractClipFrames(videoPath, clip.edit.start, clip.edit.end)
    const excerpt = wordsInRange(transcript, clip.edit.start, clip.edit.end)
      .map((w) => w.text)
      .join(' ')
      .slice(0, 900)

    const parts: ChatContentPart[] = [
      {
        type: 'text',
        text: `Clip: "${clip.title}" (${(clip.edit.end - clip.edit.start).toFixed(1)}s). Transcript: "${excerpt}"\n\nFrames below are the hook moment, the middle, and the end of the clip, in order.`
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
      visualScore: Math.max(0, Math.min(99, Math.round(res.visual_score))),
      visualSummary: res.visual_summary
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

/** Blend the text-pass score with the visual assessment (paper-style ensemble). */
export function ensembleScore(textScore: number, visualScore: number): number {
  return Math.max(0, Math.min(99, Math.round(TEXT_WEIGHT * textScore + (1 - TEXT_WEIGHT) * visualScore)))
}
