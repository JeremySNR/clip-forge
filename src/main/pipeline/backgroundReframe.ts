import type { BackgroundReframeEvent, Project } from '@shared/types'
import { selectEagerReframeIds } from '@shared/reframe'
import { mapLimit } from './concurrency'
import { ensureClipReframe } from './reframe'
import { timed } from './timing'

/**
 * Layout analysis for the top clips after the clip list is already on screen.
 *
 * Runs through `ensureClipReframe`, so opening a clip in the editor or
 * exporting it joins the same in-flight analysis instead of starting another.
 * Each finished clip is reported as soon as it is saved. A failure leaves the
 * clip pending; the editor or export retries it on demand.
 */

/** Local face analysis, composition and export share the media-job queue; two is its ceiling. */
const BACKGROUND_LIMIT = 2

const running = new Map<string, AbortController>()

export function startBackgroundReframes(
  project: Project,
  notify: (event: BackgroundReframeEvent) => void
): Promise<void> {
  cancelBackgroundReframes(project.id)
  const controller = new AbortController()
  running.set(project.id, controller)
  const eager = selectEagerReframeIds(project.clips)
  const clips = project.clips.filter(clip => eager.has(clip.id) && clip.reframeStatus === 'pending')
  return timed('background-layouts', () => mapLimit(clips, BACKGROUND_LIMIT, async (clip) => {
    if (controller.signal.aborted) return
    notify({ projectId: project.id, clipId: clip.id, state: 'running' })
    try {
      const fresh = await ensureClipReframe(project.id, clip.id, controller.signal)
      const done = fresh.clips.find(c => c.id === clip.id)
      if (done) notify({ projectId: project.id, clipId: clip.id, state: 'done', clip: done })
    } catch (error) {
      if (controller.signal.aborted) return
      console.error(`Background layout failed for clip ${clip.id}:`, error)
      notify({ projectId: project.id, clipId: clip.id, state: 'failed',
        message: error instanceof Error ? error.message : String(error) })
    }
  }), { clips: clips.length }).finally(() => {
    if (running.get(project.id) === controller) running.delete(project.id)
  })
}

/** Stop waiting for a project's background layouts; editor/export callers keep shared runs alive. */
export function cancelBackgroundReframes(projectId: string): void {
  running.get(projectId)?.abort()
  running.delete(projectId)
}
