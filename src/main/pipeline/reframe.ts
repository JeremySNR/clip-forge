import type { Clip, Project } from '@shared/types'
import { mergeReframeResult, needsReframe } from '@shared/reframe'
import { shouldAnalyzeFaces } from '@shared/videoType'
import { analyzeClipFocus, applyFocusAnalysis, type ClipFocusAnalysis } from './faces'
import { loadProject, updateProject } from '../projects'

/**
 * On-demand reframe analysis for clips the pipeline left 'pending' (see
 * shared/reframe.ts). Called when a clip is opened in the editor and, as a
 * guard, before a clip is exported.
 */

const inFlight = new Map<string, Promise<Project>>()

/**
 * Run the reframe analysis for one clip if it has not run yet, persist the
 * result and return the fresh project. A no-op (returning the current
 * project) when the clip is already analysed or no longer exists. Concurrent
 * calls for the same clip share one analysis.
 *
 * Analyses the clip's *current* trim rather than the AI's suggested range,
 * so a clip the user extended before opening it is tracked end to end.
 */
export function ensureClipReframe(
  projectId: string,
  clipId: string,
  signal?: AbortSignal
): Promise<Project> {
  const key = `${projectId}:${clipId}`
  const existing = inFlight.get(key)
  if (existing) return existing
  const run = analyseAndPersist(projectId, clipId, signal).finally(() => inFlight.delete(key))
  inFlight.set(key, run)
  return run
}

async function analyseAndPersist(
  projectId: string,
  clipId: string,
  signal?: AbortSignal
): Promise<Project> {
  const project = await loadProject(projectId)
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip || !needsReframe(clip)) return project
  if (project.sourceMissing) {
    throw new Error(
      `The source video is missing (${project.video.path}). Relink it before framing this clip.`
    )
  }

  const analysis: ClipFocusAnalysis = shouldAnalyzeFaces(project.videoType)
    ? await analyzeClipFocus(project.video.path, clip.edit.start, clip.edit.end, signal)
    : { focusTrack: null, contentType: 'screencast' }

  // Apply onto a copy: the saved clip may have moved on while the analysis
  // ran, and mergeReframeResult grafts only the analysis-owned fields.
  const analysed: Clip = { ...clip, edit: { ...clip.edit } }
  applyFocusAnalysis(analysed, analysis, project.videoType)
  analysed.reframeStatus = 'done'

  return updateProject(projectId, (fresh) => {
    const idx = fresh.clips.findIndex((c) => c.id === clipId)
    // Regenerated away while we were analysing: nothing to attach it to.
    if (idx === -1) return
    fresh.clips[idx] = mergeReframeResult(fresh.clips[idx], analysed)
  })
}
