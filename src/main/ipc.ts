import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type {
  AnalyzeOptions,
  Clip,
  ExportOptions,
  Project,
  SettingsUpdate
} from '@shared/types'
import { analyzeProject, createProject, createProjectFromUrl } from './pipeline'
import { renderClip } from './pipeline/render'
import { deleteProject, listProjects, loadProject, saveProject } from './projects'
import { getSettings, updateSettings } from './settings'

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  return (cleaned || 'clip').slice(0, 80)
}

const runningAnalyses = new Map<string, AbortController>()

export const ANALYSIS_CANCELLED_MESSAGE = 'Analysis cancelled'

export function registerIpcHandlers(): void {
  ipcMain.handle('dialog:selectVideo', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose a video',
      properties: ['openFile'],
      filters: [
        { name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:selectDirectory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose export folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('project:create', async (_e, videoPath: string) => {
    return createProject(videoPath)
  })

  ipcMain.handle('project:createFromUrl', async (event, url: string) => {
    return createProjectFromUrl(url, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('import:progress', p)
    })
  })

  ipcMain.handle('project:analyze', async (event, projectId: string, options: AnalyzeOptions) => {
    if (runningAnalyses.has(projectId)) {
      throw new Error('This project is already being analyzed.')
    }
    const controller = new AbortController()
    runningAnalyses.set(projectId, controller)
    try {
      const project = await loadProject(projectId)
      return await analyzeProject(
        project,
        options,
        (p) => {
          if (!event.sender.isDestroyed()) event.sender.send('pipeline:progress', p)
        },
        controller.signal
      )
    } catch (err) {
      if (controller.signal.aborted) throw new Error(ANALYSIS_CANCELLED_MESSAGE)
      throw err
    } finally {
      runningAnalyses.delete(projectId)
    }
  })

  ipcMain.handle('project:cancelAnalyze', async (_e, projectId: string) => {
    runningAnalyses.get(projectId)?.abort()
  })

  ipcMain.handle('project:list', async () => listProjects())
  ipcMain.handle('project:load', async (_e, id: string) => loadProject(id))
  ipcMain.handle('project:delete', async (_e, id: string) => deleteProject(id))

  ipcMain.handle('project:updateClip', async (_e, projectId: string, clip: Clip) => {
    const project = await loadProject(projectId)
    const idx = project.clips.findIndex((c) => c.id === clip.id)
    if (idx === -1) throw new Error('Clip not found')
    project.clips[idx] = clip
    await saveProject(project)
    return project
  })

  ipcMain.handle('project:rename', async (_e, projectId: string, name: string) => {
    const project = await loadProject(projectId)
    project.name = name.trim() || project.name
    await saveProject(project)
    return project
  })

  ipcMain.handle('clip:export', async (event, projectId: string, opts: ExportOptions) => {
    const project: Project = await loadProject(projectId)
    const clip = project.clips.find((c) => c.id === opts.clipId)
    if (!clip) throw new Error('Clip not found')
    const suffix = clip.edit.aspect === 'original' ? '' : ` (${clip.edit.aspect.replace(':', 'x')})`
    const outputPath = join(opts.outputDir, `${sanitizeFileName(clip.title)}${suffix}.mp4`)
    await renderClip({
      clip,
      source: project.video,
      transcript: project.transcript,
      outputPath,
      onProgress: (fraction) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('export:progress', { clipId: clip.id, progress: fraction, message: 'Rendering…' })
        }
      }
    })
    return { clipId: clip.id, outputPath }
  })

  ipcMain.handle('settings:get', async () => getSettings())
  ipcMain.handle('settings:update', async (_e, update: SettingsUpdate) => updateSettings(update))

  ipcMain.handle('shell:showItemInFolder', async (_e, path: string) => {
    shell.showItemInFolder(path)
  })
}
