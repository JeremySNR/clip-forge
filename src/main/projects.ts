import { app } from 'electron'
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project, ProjectSummary } from '@shared/types'

export function projectsRoot(): string {
  return join(app.getPath('userData'), 'projects')
}

export function projectDir(id: string): string {
  return join(projectsRoot(), id)
}

export async function saveProject(project: Project): Promise<void> {
  const dir = projectDir(project.id)
  await mkdir(dir, { recursive: true })
  project.updatedAt = Date.now()
  await writeFile(join(dir, 'project.json'), JSON.stringify(project), 'utf8')
}

export async function loadProject(id: string): Promise<Project> {
  const raw = await readFile(join(projectDir(id), 'project.json'), 'utf8')
  const project = JSON.parse(raw) as Project
  // Migrate projects saved before auto-reframing / B-roll / tighten existed.
  project.video.hasAudio ??= true
  for (const clip of project.clips) {
    clip.focusTrack ??= null
    clip.edit.framing ??= 'manual'
    clip.edit.tightenCuts ??= false
    clip.broll ??= []
  }
  return project
}

export async function deleteProject(id: string): Promise<void> {
  await rm(projectDir(id), { recursive: true, force: true })
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
