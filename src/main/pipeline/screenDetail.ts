import { throwIfSubscriptionError } from '../subscription'
import { readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Clip, ContentRegion, Transcript } from '@shared/types'
import { detailEnlargement, MIN_DETAIL_GAIN, proposedContentRegion } from '@shared/contentRegion'
import { chatJSON, type ChatContentPart } from './openai'
import { clipFrameTimes, extractClipFrames } from './visualScore'
import { probeImageDimensions, runAnalysisFfmpeg as runFfmpeg } from './ffmpeg'
import { fitRegionGraph } from './layoutFilters'

type Shots = NonNullable<NonNullable<Clip['visualLayout']>['shots']>
interface DetailInterval {
  start_frame: number; end_frame: number; detail: boolean
  region: { left: number; top: number; right: number; bottom: number }
}
const SCHEMA = { type: 'object', additionalProperties: false, required: ['intervals', 'reason'], properties: {
  reason: { type: 'string' }, intervals: { type: 'array', maxItems: 3, items: {
    type: 'object', additionalProperties: false, required: ['start_frame', 'end_frame', 'detail', 'region'], properties: {
      start_frame: { type: 'integer' }, end_frame: { type: 'integer' }, detail: { type: 'boolean' },
      region: { type: 'object', additionalProperties: false, required: ['left', 'top', 'right', 'bottom'], properties: {
        left: { type: 'integer' }, top: { type: 'integer' }, right: { type: 'integer' }, bottom: { type: 'integer' }
      } }
    }
  } }
} } as const

/** Frame-index intervals must form a complete, chronological partition of the shot. */
export function screenDetailPlan(start: number, end: number, times: number[], intervals: DetailInterval[]): Shots | null {
  if (!intervals?.length || intervals.length > 3) return null
  let cursor = 0
  const shots: Shots = []
  for (const interval of intervals) {
    const { start_frame: a, end_frame: b } = interval
    if (!Number.isInteger(a) || !Number.isInteger(b) || a !== cursor || b < a || b >= times.length) return null
    const from = a === 0 ? start : (times[a - 1] + times[a]) / 2
    const until = b === times.length - 1 ? end : (times[b] + times[b + 1]) / 2
    if (!Number.isFinite(from) || !Number.isFinite(until) || from < start || until > end || until - from < 1) return null
    const region = interval.detail === true ? proposedContentRegion(interval.region, true) : undefined
    if (interval.detail && !region) return null
    shots.push({ start: from, end: until, mode: 'fit', ...(region ? { region, overview: true } : {}) })
    cursor = b + 1
  }
  return cursor === times.length && shots.some(s => s.overview) ? shots : null
}

export async function refineScreenDetails(
  apiKey: string, model: string, videoPath: string, title: string,
  start: number, end: number, transcript: Transcript, signal?: AbortSignal
): Promise<Shots | null> {
  if (end - start < 2) return null
  let frames: string[] = []
  try {
    const times = clipFrameTimes(start, end, 9)
    frames = await extractClipFrames(videoPath, start, end, 9, signal, 1024)
    const words = transcript.segments.flatMap(s => s.words).filter(w => w.start >= start && w.start < end)
      .map(w => `[${w.start.toFixed(2)}] ${w.text}`).join(' ').slice(0, 6000)
    const parts: ChatContentPart[] = [{ type: 'text', text:
      `Plan a readable portrait screen demonstration for "${title}". The full source remains visible in a small OVERVIEW at the top. A larger DETAIL panel shows one source region underneath; captions have their own gap between panels. Choose the UI/slide region that the timed narration actually discusses. Keep complete warnings, labels and action controls with enough surrounding context. Do not merely choose the cursor, a decorative inset or arbitrary text. Results outside the detail remain visible in the overview.\n` +
      `Use at most THREE consecutive intervals covering frame indices 0 through 8. Indices are INCLUSIVE: for example 0–1 followed by 2–8; never overlap or omit an index. Transitions occur midway between adjacent sampled frames. Each interval has start_frame/end_frame and detail=true with a region in original-image 0–1000 coordinates. Keep complete relevant UI components with margins. The detail must enlarge important content by at least 1.8x compared with full-source fit; a broad region covering over half the source width is usually insufficient. Prefer the specific warning, status, draft entry or action controls discussed, not an entire editor column or article body. If text is not needed for the spoken point, do not add a redundant detail panel just to show more text. Use detail=false and the full-frame box for intervals where no useful detail is visible. Prefer a stable region; switch only when the discussed action requires it. Return intervals=[] if an overview/detail layout would not improve this shot. Do not invent text or actions between frames.\nTimed narration: ${words}` }]
    for (const [i, frame] of frames.entries()) {
      parts.push({ type: 'text', text: `Frame ${i}, source ${times[i].toFixed(2)}s.` })
      parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${(await readFile(frame)).toString('base64')}`, detail: 'high' } })
    }
    const result = await chatJSON<{ intervals: DetailInterval[]; reason: string }>(apiKey, model, [{ role: 'user', content: parts }], 'screen_detail_plan', SCHEMA, signal)
    const shots = screenDetailPlan(start, end, times, result.intervals)
    if (!shots) return null
    for (const shot of shots) {
      const narration = transcript.segments.flatMap(s => s.words).filter(w => w.start >= shot.start && w.start < shot.end).map(w => w.text).join(' ')
      if (shot.region && !await verifyScreenDetail(apiKey, model, videoPath, title, narration, shot.start, shot.end, shot.region, signal)) {
        delete shot.region
        delete shot.overview
      }
    }
    return shots.some(s => s.overview) ? shots : null
  } catch (error) {
    throwIfSubscriptionError(error)
    if (signal?.aborted) throw error
    console.error('Screen detail review failed; keeping the full source:', error)
    return null
  } finally {
    if (frames.length) await rm(dirname(frames[0]), { recursive: true, force: true }).catch(() => undefined)
  }
}

async function verifyScreenDetail(
  apiKey: string, model: string, videoPath: string, title: string, narration: string,
  start: number, end: number, region: ContentRegion, signal?: AbortSignal
): Promise<boolean> {
  let frames: string[] = []
  try {
    frames = await extractClipFrames(videoPath, start, end, 7, signal, 1024)
    const parts: ChatContentPart[] = [{ type: 'text', text:
      `Check a screen-detail layout for "${title}". Narration during this interval: ${narration.slice(0, 4000)}. Each image shows SOURCE reference, BEFORE portrait, AFTER portrait. Before/after canvases are both 360x640. After retains the source overview above enlarged detail; the black gap between panels is reserved for captions. Judge the AFTER detail itself: can a phone viewer read the labels relevant to this narration and understand its action? Reject clipping of the discussed warnings/buttons/labels, an empty or wrong detail area, lost action/result relationships even with the overview, or inadequate enlargement. Inspect all seven times. Incidental neighbouring controls, unrelated cursor activity and other text need not all appear in the detail: the overview retains context. A partly visible incidental control is not by itself grounds for rejection. Return accept=true only when useful and readable. List a few labels actually legible in the AFTER detail as evidence; do not infer them solely from the larger source reference.` }]
    for (const [i, frame] of frames.entries()) {
      const source = await probeImageDimensions(frame)
      if (detailEnlargement(region, source.width, source.height) < MIN_DETAIL_GAIN) return false
      const path = join(dirname(frame), `detail-${i}.jpg`)
      const graph = '[0:v]split=3[a][b][c];[a]scale=480:270:force_original_aspect_ratio=decrease,pad=480:640:(ow-iw)/2:(oh-ih)/2[l];' +
        fitRegionGraph('b', 'm', 'before', source, 360, 640) + ';' +
        fitRegionGraph('c', 'r', 'after', source, 360, 640, region, true) + ';[l][m][r]hstack=inputs=3[out]'
      await runFfmpeg(['-i', frame, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', path], { signal })
      parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${(await readFile(path)).toString('base64')}`, detail: 'high' } })
    }
    const result = await chatJSON<{ accept: boolean; reason: string; legible_labels: string[] }>(apiKey, model, [{ role: 'user', content: parts }],
      'screen_detail_verification', { type: 'object', additionalProperties: false, required: ['accept', 'reason', 'legible_labels'], properties: {
        accept: { type: 'boolean' }, reason: { type: 'string' }, legible_labels: { type: 'array', items: { type: 'string' } }
      } }, signal)
    return result.accept === true && result.legible_labels?.length > 0
  } finally {
    if (frames.length) await rm(dirname(frames[0]), { recursive: true, force: true }).catch(() => undefined)
  }
}
