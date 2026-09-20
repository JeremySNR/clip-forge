import { readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ContentRegion, LayoutShot } from '@shared/types'
import { presenterComposition, usefulComposition, validRectangle } from '@shared/composition'
import { chatJSON, type ChatContentPart } from './openai'
import { extractClipFrames } from './visualScore'
import { probeImageDimensions, runFfmpeg } from './ffmpeg'
import { compositionGraph, fitRegionGraph } from './layoutFilters'

/** Unlike broad content crops, a webcam inset can be much smaller than 20%. */
export function sourceRectangle(box: { left: number; top: number; right: number; bottom: number } | undefined): ContentRegion | undefined {
  if (!box) return undefined
  const r = { x: box.left / 1000, y: box.top / 1000,
    width: (box.right - box.left) / 1000, height: (box.bottom - box.top) / 1000 }
  return validRectangle(r) ? r : undefined
}

const SCHEMA = { type: 'object', additionalProperties: false, required: ['accept', 'reason', 'legible_labels'], properties: {
  accept: { type: 'boolean' }, reason: { type: 'string' },
  legible_labels: { type: 'array', items: { type: 'string' } }
} } as const

/** Review the real compositor, with a bounded alternative on rejection. No synthetic pixels. */
export async function reviewPresenterComposition(
  apiKey: string, model: string, videoPath: string, start: number, end: number,
  content: ContentRegion, presenter: ContentRegion, narration: string, signal?: AbortSignal
): Promise<Pick<LayoutShot, 'composition' | 'review'>> {
  let frames: string[] = []
  let reason = 'No readable presenter/content layout could be established.'
  try {
    // High-resolution originals retain small inset faces and fine screen labels.
    frames = await extractClipFrames(videoPath, start, end, 7, signal, 1920)
    if (frames.length !== 7) return { review: { status: 'needs-review', reason: 'Incomplete visual samples.' } }
    for (const preset of ['content-first', 'stacked'] as const) {
      const composition = presenterComposition(content, presenter, preset)
      if (!composition) break
      const parts: ChatContentPart[] = [{ type: 'text', text:
        `Review a portrait presenter/content composition. Timed interval ${start.toFixed(2)}–${end.toFixed(2)} seconds. Narration: ${narration.slice(0, 4000)}. ` +
        'Each chronological image contains SOURCE, BEFORE full-frame portrait, AFTER composited portrait. Before and after have identical dimensions. ' +
        'Accept only if the AFTER improves content readability and retains the complete relevant graph/UI/diagram and its labels, preserves the presenter head and mouth with movement margin, and never includes unrelated background fragments in the presenter panel. ' +
        'Check ALL seven samples for webcam movement, panel changes, missing content and clipping. The main content and presenter are independent crops of the same frame. ' +
        'The empty bottom band is reserved for captions. Do not require incidental editor chrome. Reject if there is no genuine separate webcam/presenter panel, if the face is soft, or if a full-width scene has merely been split into arbitrary pieces. ' +
        'List labels actually legible in the AFTER, not inferred from SOURCE. A sampled check cannot certify unseen frames; reject uncertainty. Return a concise concrete reason.' }]
      let useful = true
      for (const [i, frame] of frames.entries()) {
        const source = await probeImageDimensions(frame)
        if (!usefulComposition(composition, source)) { useful = false; break }
        const pair = join(dirname(frame), `presenter-${preset}-${i}.jpg`)
        const graph = '[0:v]split=3[a][b][c];[a]scale=640:360:force_original_aspect_ratio=decrease,pad=640:640:(ow-iw)/2:(oh-ih)/2[l];' +
          fitRegionGraph('b', 'm', 'before', source, 360, 640) + ';' +
          // Render at output size before evaluating the phone-size view.
          compositionGraph('c', 'composed', 'after', source, 1080, 1920, composition) +
          ';[composed]scale=360:640[r];[l][m][r]hstack=inputs=3[out]'
        await runFfmpeg(['-i', frame, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', pair], { signal })
        parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${(await readFile(pair)).toString('base64')}`, detail: 'high' } })
      }
      if (!useful) { reason = 'Source regions are too small, soft, or insufficiently enlarged.'; continue }
      const review = await chatJSON<{ accept: boolean; reason: string; legible_labels: string[] }>(
        apiKey, model, [{ role: 'user', content: parts }], 'presenter_composition_review', SCHEMA, signal)
      reason = typeof review.reason === 'string' ? review.reason : reason
      if (review.accept === true && Array.isArray(review.legible_labels) &&
        review.legible_labels.some(label => typeof label === 'string' && label.trim())) {
        return { composition, review: { status: 'checked', reason } }
      }
    }
    return { review: { status: 'needs-review', reason } }
  } finally {
    if (frames.length) await rm(dirname(frames[0]), { recursive: true, force: true }).catch(() => undefined)
  }
}
