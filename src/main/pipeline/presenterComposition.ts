import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Composition, ContentRegion, LayoutShot } from '@shared/types'
import { compositionIssue, presenterComposition, usefulComposition, validRectangle } from '@shared/composition'
import { chatJSON, type ChatContentPart } from './openai'
import { clipFrameTimes } from './visualScore'
import { probeVideo, runAnalysisFfmpeg as runFfmpeg } from './ffmpeg'
import { compositionGraph, fitRegionGraph } from './layoutFilters'
import { temporalEdgeTimes } from './temporalEdges'
import { reviewPanelLabels } from './reviewLabels'

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

type CompositionReview = Pick<LayoutShot, 'composition' | 'review'> & { retryTimes?: number[]; repairBounds?: boolean }

/** Models often draw a tight box around the current labels. Leave room for
 * nearby line endpoints and label movement before reviewing rendered pixels,
 * without letting the added margin duplicate the separate presenter panel. */
function contentMargin(r: ContentRegion, presenter: ContentRegion): ContentRegion {
  const x = Math.max(0, r.x - .03, presenter.x + presenter.width <= r.x ? presenter.x + presenter.width : 0)
  const y = Math.max(0, r.y - .05, presenter.y + presenter.height <= r.y ? presenter.y + presenter.height : 0)
  const right = Math.min(1, r.x + r.width + .03, presenter.x >= r.x + r.width ? presenter.x : 1)
  const bottom = Math.min(1, r.y + r.height + .05, presenter.y >= r.y + r.height ? presenter.y : 1)
  return { x, y, width: right - x, height: bottom - y }
}

/** Review the real compositor, with a bounded alternative on rejection. No synthetic pixels. */
export async function reviewPresenterComposition(
  apiKey: string, model: string, videoPath: string, start: number, end: number,
  content: ContentRegion, presenter: ContentRegion, narration: string, signal?: AbortSignal
): Promise<CompositionReview> {
  // Apply containment margins exactly once, not again when reusing a checked
  // composition as a new proposal.
  const inset = { x: presenter.x + presenter.width * .03, y: presenter.y + presenter.height * .03,
    width: presenter.width * .94, height: presenter.height * .94 }
  const candidates = (['content-first', 'stacked'] as const)
    .map(preset => presenterComposition(contentMargin(content, presenter), inset, preset))
    .filter((c): c is Composition => Boolean(c))
  return reviewCompositions(apiKey, model, videoPath, start, end, candidates, narration, signal)
}

/** Retrieved geometry has no authority until checked against the new interval. */
export function reviewExistingComposition(
  apiKey: string, model: string, videoPath: string, start: number, end: number,
  composition: Composition, narration: string, signal?: AbortSignal
): Promise<CompositionReview> {
  return reviewCompositions(apiKey, model, videoPath, start, end, [composition], narration, signal, true)
}

async function reviewCompositions(
  apiKey: string, model: string, videoPath: string, start: number, end: number,
  candidates: Composition[], narration: string, signal?: AbortSignal, checkEdges = false
): Promise<CompositionReview> {
  const source = await probeVideo(videoPath)
  const candidate = candidates.find(c => usefulComposition(c, source))
  if (!candidate) return { repairBounds: true, review: { status: 'needs-review', reason: candidates.length
    ? compositionIssue(candidates[0], source)!
    : 'Content and presenter bounds overlap or are invalid. Locate the actual webcam rectangle separately from the relevant screen content.' } }
  const directory = await mkdtemp(join(tmpdir(), 'cutawan-presenter-review-'))
  let reason = 'No readable presenter/content layout could be established.'
  try {
    let retryTimes: number[] = []
    if (candidate) {
      retryTimes = await temporalEdgeTimes(videoPath, start, end,
        candidate.layers.find(layer => layer.role === 'content')!.source, checkEdges, signal)
      if (checkEdges && retryTimes.length) return { retryTimes, review: { status: 'needs-review',
        reason: 'Content touches the proposed crop during the interval; fresh bounds are needed.' } }
    }
    const times = [...new Set([...clipFrameTimes(start, end, 7), ...retryTimes])].sort((a, b) => a - b)
    const labels = await reviewPanelLabels(directory)
    for (const composition of candidates) {
      const preset = composition.preset
      if (!usefulComposition(composition, source)) { reason = 'Source regions are too small, soft, or insufficiently enlarged.'; continue }
      const parts: ChatContentPart[] = [{ type: 'text', text:
        `Review a portrait presenter/content composition. Timed interval ${start.toFixed(2)}–${end.toFixed(2)} seconds. Narration: ${narration.slice(0, 4000)}. ` +
        'Each chronological image contains SOURCE, BEFORE full-frame portrait, AFTER composited portrait. Before and after have identical dimensions. ' +
        'The panels are labelled. Count presenter duplicates only WITHIN the rightmost AFTER panel: the same person appearing in the SOURCE and BEFORE references is expected and is not duplication in the output. ' +
        'Accept only if the AFTER improves content readability and retains the complete relevant graph/UI/diagram and its labels, preserves the presenter head and mouth with movement margin, and never includes unrelated background fragments in the presenter panel. ' +
        `Check ALL ${times.length} samples for webcam movement, panel changes, missing content and clipping. The main content and presenter are independent crops of the same frame. ` +
        (retryTimes.length ? 'Extra samples show a local crop-edge alert. Inspect whether meaningful content is cut; incidental editing guides or cursor handles alone are not a reason to reject. ' : '') +
        'The empty bottom band is reserved for captions. Do not require incidental editor chrome. Reject if there is no genuine separate webcam/presenter panel, if the face is soft, or if a full-width scene has merely been split into arbitrary pieces. ' +
        'List labels actually legible in the AFTER, not inferred from SOURCE. A sampled check cannot certify unseen frames; reject uncertainty. Return a concise concrete reason.' }]
      for (const [i, time] of times.entries()) {
        const pair = join(directory, `presenter-${preset}-${i}.jpg`)
        const graph = '[0:v]split=3[a][b][c];[a]scale=640:360:force_original_aspect_ratio=decrease,pad=640:640:(ow-iw)/2:(oh-ih)/2[l];' +
          fitRegionGraph('b', 'm', 'before', source, 360, 640) + ';' +
          // Render at output size before evaluating the phone-size view.
          compositionGraph('c', 'composed', 'after', source, 1080, 1920, composition) +
          `;[composed]scale=360:640[r];[l][m][r]hstack=inputs=3,pad=iw:ih+32:0:32:color=0x202020,${labels}[out]`
        // Crop native pixels before resizing: a 4K inset must not be judged from
        // an already-downscaled thumbnail. Decode only one frame per proof.
        let bytes: Buffer | undefined
        // Low-FPS media can have no timestamp after the last requested sample.
        // Step back within this shot only; never validate a neighbouring scene.
        for (const seek of new Set([time, time - .25, time - .5, time - 1].map(t => Math.max(start, t)))) {
          await rm(pair, { force: true })
          await runFfmpeg(['-ss', seek.toFixed(3), '-i', videoPath, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', pair], { signal })
          bytes = await readFile(pair).catch(() => undefined)
          if (bytes?.length) break
        }
        if (!bytes?.length) throw new Error(`Incomplete composition sample near ${time.toFixed(3)}s`)
        parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${bytes.toString('base64')}`, detail: 'high' } })
      }
      const review = await chatJSON<{ accept: boolean; reason: string; legible_labels: string[] }>(
        apiKey, model, [{ role: 'user', content: parts }], 'presenter_composition_review', SCHEMA, signal)
      reason = typeof review.reason === 'string' ? review.reason : reason
      if (review.accept === true && Array.isArray(review.legible_labels) &&
        review.legible_labels.some(label => typeof label === 'string' && label.trim())) {
        return { composition, review: { status: 'checked', reason } }
      }
      // Both presets share source bounds. Repair a suspect crop rather than
      // spending another review on the same collision in a different template.
      if (retryTimes.length) return { retryTimes, review: { status: 'needs-review', reason } }
    }
    return { review: { status: 'needs-review', reason } }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}
