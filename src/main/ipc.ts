import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { rm } from 'node:fs/promises'
import type {
  AnalyzeOptions,
  Clip,
  ExportOptions,
  Project,
  SettingsUpdate
} from '@shared/types'
import { analyzeProject, createProject, createProjectFromUrl } from './pipeline'
import { downloadGpuFfmpeg } from './pipeline/encoders'
import { probeVideo } from './pipeline/ffmpeg'
import { renderClip } from './pipeline/render'
import { sanitizeFileName, uniqueOutputPath } from './exportPath'
import { deleteProject, listProjects, loadProject, saveProject } from './projects'
import { getExportPreferences, getSettings, updateSettings } from './settings'

const runningAnalyses = new Map<string, AbortController>()
const runningExports = new Map<string, AbortController>()

export const ANALYSIS_CANCELLED_MESSAGE = 'Analysis cancelled'
export const EXPORT_CANCELLED_MESSAGE = 'Export cancelled'

/** How far apart durations may be for a relinked file to count as the same video. */
const RELINK_DURATION_TOLERANCE_SEC = 2

const VIDEO_FILTERS = [
  { name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv'] }
]

async function pickVideoFile(sender: Electron.WebContents, title: string): Promise<string | null> {
  // Headless/CI hook (like CLIPFORGE_SMOKE): skip the native dialog.
  if (process.env.CLIPFORGE_SELECT_VIDEO) return process.env.CLIPFORGE_SELECT_VIDEO
  const win = BrowserWindow.fromWebContents(sender)
  const result = await dialog.showOpenDialog(win!, {
    title,
    properties: ['openFile'],
    filters: VIDEO_FILTERS
  })
  return result.canceled ? null : result.filePaths[0]
}

export function registerIpcHandlers(): void {
  ipcMain.handle('dialog:selectVideo', async (event) => {
    return pickVideoFile(event.sender, 'Choose a video')
  })

  ipcMain.handle('dialog:selectDirectory', async (event) => {
    // Headless/CI hook (like CLIPFORGE_SMOKE): skip the native dialog.
    if (process.env.CLIPFORGE_EXPORT_DIR) return process.env.CLIPFORGE_EXPORT_DIR
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
      if (project.sourceMissing) {
        throw new Error(
          `The source video is missing (${project.video.path}). Relink it before generating clips.`
        )
      }
      return await analyzeProject(
        project,
        options,
        (p) => {
          if (!event.sender.isDestroyed()) event.sender.send('pipeline:progress', p)
        },
        controller.signal
      )
    } catch (err) {
      if (controller.signal.aborted) throw new Error(ANALYSIS_CANCELLED_MESSAGE, { cause: err })
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

  ipcMain.handle(
    'project:updateTranscriptWord',
    async (_e, projectId: string, segmentId: number, wordIndex: number, text: string) => {
      const project = await loadProject(projectId)
      const segment = project.transcript?.segments.find((s) => s.id === segmentId)
      const word = segment?.words[wordIndex]
      if (!segment || !word) throw new Error('Transcript word not found')
      word.text = text.trim()
      segment.text = segment.words
        .map((w) => w.text)
        .filter((t) => t.length > 0)
        .join(' ')
      await saveProject(project)
      return project
    }
  )

  ipcMain.handle('project:relinkVideo', async (event, projectId: string) => {
    const project = await loadProject(projectId)
    const picked = await pickVideoFile(event.sender, `Locate "${project.video.fileName}"`)
    if (!picked) return project

    const video = await probeVideo(picked)
    if (Math.abs(video.durationSec - project.video.durationSec) > RELINK_DURATION_TOLERANCE_SEC) {
      throw new Error(
        `That file is ${video.durationSec.toFixed(0)}s long but this project's video was ` +
          `${project.video.durationSec.toFixed(0)}s. The transcript and clips would not line up — ` +
          'pick the same video.'
      )
    }
    project.video = video
    project.sourceMissing = false
    await saveProject(project)
    return project
  })

  ipcMain.handle('clip:export', async (event, projectId: string, opts: ExportOptions) => {
    const project: Project = await loadProject(projectId)
    const clip = project.clips.find((c) => c.id === opts.clipId)
    if (!clip) throw new Error('Clip not found')
    if (project.sourceMissing) {
      throw new Error(`The source video is missing (${project.video.path}). Relink it to export.`)
    }
    if (runningExports.has(clip.id)) throw new Error('This clip is already exporting.')

    const suffix = clip.edit.aspect === 'original' ? '' : ` (${clip.edit.aspect.replace(':', 'x')})`
    const outputPath = uniqueOutputPath(opts.outputDir, `${sanitizeFileName(clip.title)}${suffix}`)
    const prefs = getExportPreferences()
    const controller = new AbortController()
    runningExports.set(clip.id, controller)
    try {
      await renderClip({
        clip,
        source: project.video,
        transcript: project.transcript,
        outputPath,
        encoder: prefs.encoder,
        quality: prefs.quality,
        signal: controller.signal,
        onProgress: (fraction) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('export:progress', { clipId: clip.id, progress: fraction, message: 'Rendering…' })
          }
        }
      })
    } catch (err) {
      if (controller.signal.aborted) {
        await rm(outputPath, { force: true }).catch(() => undefined)
        throw new Error(EXPORT_CANCELLED_MESSAGE, { cause: err })
      }
      throw err
    } finally {
      runningExports.delete(clip.id)
    }
    return { clipId: clip.id, outputPath }
  })

  ipcMain.handle('clip:cancelExport', async (_e, clipId: string) => {
    runningExports.get(clipId)?.abort()
  })

  ipcMain.handle('settings:downloadGpuFfmpeg', async (event) => {
    return downloadGpuFfmpeg((p) => {
      if (!event.sender.isDestroyed()) event.sender.send('gpu:progress', p)
    })
  })

  ipcMain.handle('settings:get', async () => getSettings())
  ipcMain.handle('settings:update', async (_e, update: SettingsUpdate) => updateSettings(update))

  ipcMain.handle('shell:showItemInFolder', async (_e, path: string) => {
    shell.showItemInFolder(path)
  })
}
