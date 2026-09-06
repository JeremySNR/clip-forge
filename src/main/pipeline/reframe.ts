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

interface Run {
  promise: Promise<Project>
  controller: AbortController
  /** Callers still interested in the result; the run aborts only when none are left. */
  waiters: number
}

const inFlight = new Map<string, Run>()

/**
 * Run the reframe analysis for one clip if it has not run yet, persist the
 * result and return the fresh project. A no-op (returning the current
 * project) when the clip is already analysed or no longer exists.
 *
 * Concurrent calls for the same clip share one analysis. Each caller's
 * signal governs only its own interest: an aborted caller stops waiting at
 * once, but the shared run itself is cancelled only when every caller has
 * aborted — cancelling an export must not strand an editor that is waiting
 * on the same clip, and a caller without a signal (the editor) keeps the run
 * alive.
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
  let run = inFlight.get(key)
  if (!run) {
    const controller = new AbortController()
    const started: Run = {
      controller,
      waiters: 0,
      promise: analyseAndPersist(projectId, clipId, controller.signal).finally(() =>
        inFlight.delete(key)
      )
    }
    inFlight.set(key, started)
    run = started
  }
  return joinRun(run, signal)
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Reframe analysis cancelled', 'AbortError')
}

function joinRun(run: Run, signal?: AbortSignal): Promise<Project> {
  if (!signal) {
    run.waiters++
    return run.promise
  }
  if (signal.aborted) return Promise.reject(abortError(signal))
  run.waiters++
  return new Promise<Project>((resolve, reject) => {
    const onAbort = (): void => {
      run.waiters--
      if (run.waiters === 0) run.controller.abort()
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    run.promise.then(
      (project) => {
        signal.removeEventListener('abort', onAbort)
        resolve(project)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
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
    fresh.clips[idx] = mergeReframeResult(fresh.clips[idx], analysed, fresh.videoType)
  })
}
