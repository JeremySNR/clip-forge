import type { Clip, Transcript, VideoType } from '@shared/types'
import { shouldAnalyzeFaces } from '@shared/videoType'
import { markReframeComplete } from '@shared/reframe'
import { analyzeClipFocus, applyFocusAnalysis, type ClipFocusAnalysis } from './faces'
import { refineComposition } from './composition'
import { assessClipVisuals } from './visualScore'
import { screenTransitions } from './screenCuts'

/** One route for initial analysis and on-demand/legacy projects. */
export async function analyzeClipLayout(
  videoPath: string, clip: Clip, videoType: VideoType,
  apiKey: string, model: string, transcript?: Transcript, signal?: AbortSignal
): Promise<void> {
  const started = performance.now()
  // Old saved assessments lack layout evidence. Refresh it once, rather than
  // making every screen clip run dense active-speaker tracking first.
  if (apiKey && transcript && videoType !== 'talking-head' &&
      (!clip.visualLayout?.kind || clip.visualLayout.start > clip.edit.start || clip.visualLayout.end < clip.edit.end)) {
    const visual = await assessClipVisuals(apiKey, model, videoPath, transcript, clip, signal)
    if (visual) clip.visualLayout = visual.visualLayout
  }
  const screen = clip.visualLayout?.kind === 'screen' && videoType !== 'talking-head' &&
    clip.visualLayout.start <= clip.edit.start && clip.visualLayout.end >= clip.edit.end
  const analysis: ClipFocusAnalysis = !screen && shouldAnalyzeFaces(videoType)
    ? await analyzeClipFocus(videoPath, clip.edit.start, clip.edit.end, signal)
    : { focusTrack: null, contentType: 'screencast' }
  if (screen && !clip.visualLayout?.panels) {
    analysis.sceneTransitions = await screenTransitions(videoPath, clip.edit.start, clip.edit.end, signal)
  }
  if (apiKey && videoType !== 'talking-head') {
    await refineComposition(apiKey, model, videoPath, clip, analysis.sceneCuts, signal,
      analysis.focusTrack, analysis.sceneTransitions, transcript)
    // A single panel proposal may fail because the source changes midway.
    // Try shot-specific regions once, only when real screen changes exist.
    if (screen && clip.visualLayout?.panels &&
        !clip.visualLayout.shots?.some(s => s.composition)) {
      analysis.sceneTransitions = await screenTransitions(videoPath, clip.edit.start, clip.edit.end, signal)
      if (analysis.sceneTransitions.length) {
        clip.visualLayout = { ...clip.visualLayout, panels: undefined }
        await refineComposition(apiKey, model, videoPath, clip, undefined, signal,
          null, analysis.sceneTransitions, transcript)
      }
    }
  }
  signal?.throwIfAborted()
  applyFocusAnalysis(clip, analysis, videoType)
  markReframeComplete(clip)
  console.info('[layout]', JSON.stringify({ clipId: clip.id, route: screen ? 'screen' : 'camera',
    seconds: Math.round((performance.now() - started) / 100) / 10,
    composed: clip.visualLayout?.shots?.filter(s => s.composition).length ?? 0,
    review: clip.visualLayout?.shots?.filter(s => s.review?.status === 'needs-review').map(s => s.review?.reason) ?? [] }))
}
