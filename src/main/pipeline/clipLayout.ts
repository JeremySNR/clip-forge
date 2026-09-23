import type { Clip, Transcript, VideoType } from '@shared/types'
import { shouldAnalyzeFaces } from '@shared/videoType'
import { markReframeComplete } from '@shared/reframe'
import { analyzeClipFocus, applyFocusAnalysis, type ClipFocusAnalysis } from './faces'
import { refineComposition } from './composition'
import { assessClipVisuals } from './visualScore'
import { screenTransitions } from './screenCuts'
import type { LayoutMemory } from './layoutMemory'
import { detectPresenterPanel, triageClipStyle, type ClipTriage } from './shotTriage'
import { panelScreenLayout } from '@shared/shotStyle'
import { probeVideo } from './ffmpeg'

/** One route for initial analysis and on-demand/legacy projects. */
export async function analyzeClipLayout(
  videoPath: string, clip: Clip, videoType: VideoType,
  apiKey: string, model: string, transcript?: Transcript, signal?: AbortSignal, memory?: LayoutMemory
): Promise<void> {
  const started = performance.now()
  // Shadow mode, opt-in: the local style triage is logged beside the route
  // actually taken so the two can be compared on real footage before it
  // decides anything. It costs a few seconds per clip, so it is off by default.
  const triage = process.env.CUTAWAN_LAYOUT_TRIAGE !== '1' ? null
    : await triageClipStyle(videoPath, clip.edit.start, clip.edit.end, signal).catch((error: unknown): ClipTriage | null => {
      if (signal?.aborted) throw error
      console.warn('Local style triage failed:', error)
      return null
    })
  // Old saved assessments lack layout evidence. Refresh it once, rather than
  // making every screen clip run dense active-speaker tracking first.
  if (apiKey && transcript && videoType !== 'talking-head' &&
      (!clip.visualLayout?.kind || clip.visualLayout.start > clip.edit.start || clip.visualLayout.end < clip.edit.end)) {
    const visual = await assessClipVisuals(apiKey, model, videoPath, transcript, clip, signal)
    if (visual) clip.visualLayout = visual.visualLayout
  }
  // A fixed webcam panel over a screen share is unmistakable in the pixels.
  // Route such clips as screen recordings even when the review called them
  // camera footage (a face is visible) or never ran (offline): face tracking
  // would otherwise crop the whole clip down to the webcam.
  if (videoType !== 'talking-head' && clip.visualLayout?.kind !== 'screen' && clip.visualLayout?.kind !== 'mixed') {
    const panel = await detectPresenterPanel(videoPath, clip.edit.start, clip.edit.end, signal).catch((error: unknown) => {
      if (signal?.aborted) throw error
      console.warn('Local presenter panel detection failed:', error)
      return undefined
    })
    if (panel) {
      const source = await probeVideo(videoPath)
      clip.visualLayout = panelScreenLayout(clip.edit.start, clip.edit.end, panel, source,
        Boolean(apiKey) && clip.edit.aspect === '9:16', clip.visualLayout)
      console.info('[presenter-panel]', JSON.stringify({ clipId: clip.id, route: 'screen', panel, verified: Boolean(apiKey) }))
    }
  }
  const screen = clip.visualLayout?.kind === 'screen' && videoType !== 'talking-head' &&
    clip.visualLayout.start <= clip.edit.start && clip.visualLayout.end >= clip.edit.end
  const analysis: ClipFocusAnalysis = !screen && shouldAnalyzeFaces(videoType)
    ? await analyzeClipFocus(videoPath, clip.edit.start, clip.edit.end, signal)
    : { focusTrack: null, contentType: 'screencast' }
  if (screen) {
    analysis.sceneTransitions = await screenTransitions(videoPath, clip.edit.start, clip.edit.end, signal)
    if (analysis.sceneTransitions.length && clip.visualLayout) {
      clip.visualLayout = { ...clip.visualLayout, panels: undefined }
    }
  }
  if (apiKey && videoType !== 'talking-head') {
    await refineComposition(apiKey, model, videoPath, clip, analysis.sceneCuts, signal,
      analysis.focusTrack, analysis.sceneTransitions, transcript, memory)
  }
  signal?.throwIfAborted()
  applyFocusAnalysis(clip, analysis, videoType)
  markReframeComplete(clip)
  memory?.remember(clip)
  console.info('[layout]', JSON.stringify({ clipId: clip.id, route: screen ? 'screen' : 'camera',
    seconds: Math.round((performance.now() - started) / 100) / 10,
    composed: clip.visualLayout?.shots?.filter(s => s.composition).length ?? 0,
    review: clip.visualLayout?.shots?.filter(s => s.review?.status === 'needs-review').map(s => s.review?.reason) ?? [] }))
  if (triage) {
    console.info('[layout-triage]', JSON.stringify({ clipId: clip.id, style: triage.style,
      recommendation: triage.recommendation, confidence: triage.confidence, smallFaces: triage.smallFaces,
      inset: triage.inset, seconds: Math.round(triage.seconds * 100) / 100,
      samples: triage.samples.map(s => s.style), actual: { contentType: clip.contentType,
        kind: clip.visualLayout?.kind, reframeMode: clip.edit.reframeMode,
        presets: [...new Set(clip.visualLayout?.shots?.map(s => s.composition?.preset ?? s.mode) ?? [])] } }))
  }
}
