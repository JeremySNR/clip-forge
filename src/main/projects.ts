import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project, ProjectSummary } from '@shared/types'
import { allowMediaPath } from './mediaAccess'

export function projectsRoot(): string {
  return join(app.getPath('userData'), 'projects')
}

export function projectDir(id: string): string {
  return join(projectsRoot(), id)
}

/**
 * Per-project write lock. Everything that writes project.json goes through
 * here, so concurrent IPC handlers (a clip edit landing while a caption
 * generates, a rename during analysis) queue up instead of interleaving
 * load→mutate→save on the same file and silently dropping each other's
 * changes. Exported for tests.
 */
const projectLocks = new Map<string, Promise<unknown>>()

export async function withProjectLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = projectLocks.get(id) ?? Promise.resolve()
  // Run after the predecessor settles, whether it succeeded or failed.
  const run = previous.then(fn, fn)
  const tail = run.then(
    () => undefined,
    () => undefined
  )
  projectLocks.set(id, tail)
  try {
    return await run
  } finally {
    // Drop the entry once the queue drains so the map cannot grow forever.
    if (projectLocks.get(id) === tail) projectLocks.delete(id)
  }
}

async function persistProject(project: Project): Promise<void> {
  const dir = projectDir(project.id)
  await mkdir(dir, { recursive: true })
  project.updatedAt = Date.now()
  allowMediaPath(project.video.path)
  // sourceMissing is transient state, recomputed on every load.
  const { sourceMissing: _omit, ...persisted } = project
  await writeFile(join(dir, 'project.json'), JSON.stringify(persisted), 'utf8')
}

export async function saveProject(project: Project): Promise<void> {
  await withProjectLock(project.id, () => persistProject(project))
}

/**
 * Atomic read-modify-write: load the freshest copy from disk, apply `mutate`,
 * persist, all under the project's lock. This is the safe way to change a
 * project in response to user actions — handlers that load once and save a
 * stale copy later lose whatever happened in between. Keep `mutate` quick
 * (no network calls) so edits queued behind it stay snappy; a throw inside
 * `mutate` abandons the write and propagates.
 */
export async function updateProject(
  id: string,
  mutate: (project: Project) => void | Promise<void>
): Promise<Project> {
  return withProjectLock(id, async () => {
    const project = await loadProject(id)
    await mutate(project)
    await persistProject(project)
    return project
  })
}

export async function loadProject(id: string): Promise<Project> {
  const raw = await readFile(join(projectDir(id), 'project.json'), 'utf8')
  const project = JSON.parse(raw) as Project
  // Migrate projects saved before auto-reframing / B-roll / tighten existed.
  project.video.hasAudio ??= true
  project.videoType ??= 'auto'
  for (const clip of project.clips) {
    clip.focusTrack ??= null
    clip.contentType ??= null
    clip.edit.framing ??= 'manual'
    clip.edit.tightenCuts ??= false
    clip.edit.autoZoom ??= false
    clip.broll ??= []
    clip.visualSummary ??= null
  }
  project.sourceMissing = !existsSync(project.video.path)
  allowMediaPath(project.video.path)
  return project
}

export async function deleteProject(id: string): Promise<void> {
  // Under the lock so an in-flight save cannot resurrect a deleted project.
  await withProjectLock(id, () => rm(projectDir(id), { recursive: true, force: true }))
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const root = projectsRoot()
  await mkdir(root, { recursive: true })
  const entries = await readdir(root, { withFileTypes: true })
  const summaries: ProjectSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const p = await loadProject(entry.name)
      summaries.push({
        id: p.id,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        name: p.name,
        videoPath: p.video.path,
        videoFileName: p.video.fileName,
        durationSec: p.video.durationSec,
        clipCount: p.clips.length,
        thumbnailPath: p.clips.find((c) => c.thumbnailPath)?.thumbnailPath ?? null
      })
    } catch {
      /* skip unreadable project folders */
    }
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  return summaries
}
