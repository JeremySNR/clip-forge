import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import type {
  AnalyzeOptions,
  Clip,
  ExportOptions,
  Project,
  SettingsUpdate
} from '@shared/types'
import { VIDEO_EXTENSIONS } from '@shared/video'
import { analyzeProject, createProject, createProjectFromUrl } from './pipeline'
import { downloadGpuFfmpeg } from './pipeline/encoders'
import { compressToTargetSize, probeVideo } from './pipeline/ffmpeg'
import { getTimeline } from './pipeline/timeline'
import { renderClip } from './pipeline/render'
import { generateSocialCaption } from './pipeline/socialCaption'
import { generateWorkvivoCaption } from './pipeline/workvivoCaption'
import {
  findUserByEmail,
  listSpaces,
  postClipToSpace,
  testConnection,
  WorkvivoError
} from './pipeline/workvivo'
import { addCustomFonts, listCustomFonts, removeCustomFont, renderFontsDir } from './fonts'
import { clearImportCookiesFile, installImportCookiesFile } from './cookies'
import { checkForUpdates, downloadUpdate, installUpdate, updateFromSource } from './updates'
import { isMediaPathAllowed } from './mediaAccess'
import { sanitizeFileName, uniqueOutputPath } from './exportPath'
import { deleteProject, listProjects, loadProject, saveProject } from './projects'
import {
  getApiKey,
  getBrandingSettings,
  getBrandVoiceSettings,
  getExportPreferences,
  getModelPreferences,
  getSettings,
  getWorkvivoConfig,
  updateSettings
} from './settings'

const runningAnalyses = new Map<string, AbortController>()
const runningExports = new Map<string, AbortController>()
const runningWorkvivoPosts = new Map<string, AbortController>()

export const ANALYSIS_CANCELLED_MESSAGE = 'Analysis cancelled'
export const EXPORT_CANCELLED_MESSAGE = 'Export cancelled'
export const WORKVIVO_POST_CANCELLED_MESSAGE = 'WorkVivo post cancelled'

const MB = 1024 * 1024
/**
 * WorkVivo's Customer API rejects large inline uploads with HTTP 413, well below
 * the size its web uploader accepts (that path uses chunked upload; the API does
 * not). The exact cap is undocumented, so we pre-shrink very large renders and,
 * on a 413, retry with progressively smaller targets until it fits or we give up.
 */
const WORKVIVO_PRESHRINK_BYTES = 64 * MB
const WORKVIVO_FIT_TARGETS: Array<{ bytes: number; maxHeight?: number }> = [
  { bytes: 40 * MB },
  { bytes: 20 * MB, maxHeight: 720 },
  { bytes: 10 * MB, maxHeight: 720 }
]

/** How far apart durations may be for a relinked file to count as the same video. */
const RELINK_DURATION_TOLERANCE_SEC = 2

const VIDEO_FILTERS = [{ name: 'Videos', extensions: [...VIDEO_EXTENSIONS] }]

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
    const branding = getBrandingSettings()
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
        branding:
          branding.enabled && branding.imagePath && existsSync(branding.imagePath)
            ? branding
            : null,
        fontsDirPath: await renderFontsDir(),
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

  ipcMain.handle('clip:generateCaption', async (_e, projectId: string, clipId: string) => {
    const project = await loadProject(projectId)
    const clip = project.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error('Clip not found')
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('Add your OpenAI API key in Settings first.')
    const caption = await generateSocialCaption(
      apiKey,
      getModelPreferences().analysisModel,
      clip,
      project.transcript
    )
    clip.caption = caption
    await saveProject(project)
    return project
  })

  ipcMain.handle('workvivo:generateCaption', async (_e, projectId: string, clipId: string) => {
    const project = await loadProject(projectId)
    const clip = project.clips.find((c) => c.id === clipId)
    if (!clip) throw new Error('Clip not found')
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('Add your OpenAI API key in Settings first.')
    const caption = await generateWorkvivoCaption(
      apiKey,
      getModelPreferences().analysisModel,
      clip,
      project.transcript,
      getBrandVoiceSettings()
    )
    clip.workvivoCaption = caption
    await saveProject(project)
    return project
  })

  ipcMain.handle('workvivo:testConnection', async () => {
    const cfg = getWorkvivoConfig()
    if (!cfg) {
      return { ok: false, message: 'Add your WorkVivo URL, Organisation ID and API key first.' }
    }
    return testConnection(cfg.request)
  })

  ipcMain.handle('workvivo:listSpaces', async () => {
    const cfg = getWorkvivoConfig()
    if (!cfg) return []
    return listSpaces(cfg.request)
  })

  ipcMain.handle('workvivo:findUser', async (_e, email: string) => {
    const cfg = getWorkvivoConfig()
    if (!cfg) {
      throw new Error('Add your WorkVivo URL, Organisation ID and API key first.')
    }
    if (!email.trim()) throw new Error('Enter an email address to look up.')
    return findUserByEmail(cfg.request, email.trim())
  })

  ipcMain.handle(
    'workvivo:postClip',
    async (
      event,
      projectId: string,
      clipId: string,
      spaceId: string,
      workvivoCaption?: string | null
    ) => {
      const cfg = getWorkvivoConfig()
      if (!cfg) {
        throw new Error(
          'WorkVivo is not connected. Add your URL, Organisation ID and API key in Settings.'
        )
      }
      if (!spaceId) throw new Error('Choose a WorkVivo space to post to.')
      if (!cfg.postAsUserId) {
        throw new Error(
          'Set the “Post as” WorkVivo user ID in Settings → WorkVivo first — WorkVivo requires every post to be attributed to a user.'
        )
      }
      const project = await loadProject(projectId)
      const clip = project.clips.find((c) => c.id === clipId)
      if (!clip) throw new Error('Clip not found')
      if (project.sourceMissing) {
        throw new Error(`The source video is missing (${project.video.path}). Relink it to post.`)
      }
      if (runningWorkvivoPosts.has(clipId)) throw new Error('This clip is already being posted.')

      const text = (
        (typeof workvivoCaption === 'string' ? workvivoCaption.trim() : '') ||
        clip.workvivoCaption?.trim() ||
        clip.caption?.trim() ||
        clip.title ||
        ''
      ).trim()
      const prefs = getExportPreferences()
      const branding = getBrandingSettings()
      const controller = new AbortController()
      runningWorkvivoPosts.set(clipId, controller)
      const dir = join(tmpdir(), 'clipforge', 'workvivo')
      await mkdir(dir, { recursive: true })
      const outputPath = join(dir, `${clipId}-${randomUUID()}.mp4`)
      // Temp files created while shrinking to fit WorkVivo's upload cap.
      const fitPaths: string[] = []
      const send = (progress: number, message: string): void => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('workvivo:progress', { clipId, progress, message })
        }
      }
      try {
        send(0, 'Rendering clip…')
        await renderClip({
          clip,
          source: project.video,
          transcript: project.transcript,
          outputPath,
          encoder: prefs.encoder,
          quality: prefs.quality,
          branding:
            branding.enabled && branding.imagePath && existsSync(branding.imagePath)
              ? branding
              : null,
          fontsDirPath: await renderFontsDir(),
          signal: controller.signal,
          // Rendering is the first 80% of the job; upload is the rest.
          onProgress: (fraction) => send(fraction * 0.8, 'Rendering clip…')
        })
        // Upload, shrinking to fit WorkVivo's request-size cap when needed.
        let uploadPath = outputPath
        const rendered = await stat(outputPath)
        if (rendered.size > WORKVIVO_PRESHRINK_BYTES) {
          send(0.82, 'Compressing for WorkVivo…')
          const fit = join(dir, `${clipId}-fit-0.mp4`)
          fitPaths.push(fit)
          await compressToTargetSize(outputPath, fit, WORKVIVO_PRESHRINK_BYTES, {
            signal: controller.signal,
            onProgress: (f) => send(0.8 + f * 0.05, 'Compressing for WorkVivo…')
          })
          uploadPath = fit
        }
        for (let attempt = 0; ; attempt++) {
          try {
            send(0.85, 'Uploading to WorkVivo…')
            const result = await postClipToSpace(cfg.request, {
              videoPath: uploadPath,
              text,
              spaceId,
              postAsUserId: cfg.postAsUserId || undefined,
              signal: controller.signal
            })
            send(1, 'Posted to WorkVivo')
            return result
          } catch (uploadErr) {
            const tooLarge = uploadErr instanceof WorkvivoError && uploadErr.status === 413
            if (!tooLarge || attempt >= WORKVIVO_FIT_TARGETS.length) {
              if (tooLarge) {
                throw new Error(
                  'This clip is too large for WorkVivo even after compression. Try a shorter clip or lower the export quality.',
                  { cause: uploadErr }
                )
              }
              throw uploadErr
            }
            // Re-compress from the original render (not the previous attempt) to
            // avoid stacking generation loss, aiming at the next smaller target.
            const target = WORKVIVO_FIT_TARGETS[attempt]
            const fit = join(dir, `${clipId}-fit-${attempt + 1}.mp4`)
            fitPaths.push(fit)
            send(0.82, 'Video too large — compressing for WorkVivo…')
            await compressToTargetSize(outputPath, fit, target.bytes, {
              maxHeight: target.maxHeight,
              signal: controller.signal,
              onProgress: (f) => send(0.8 + f * 0.05, 'Compressing for WorkVivo…')
            })
            uploadPath = fit
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          throw new Error(WORKVIVO_POST_CANCELLED_MESSAGE, { cause: err })
        }
        throw err
      } finally {
        runningWorkvivoPosts.delete(clipId)
        await Promise.all(
          [outputPath, ...fitPaths].map((p) => rm(p, { force: true }).catch(() => undefined))
        )
      }
    }
  )

  ipcMain.handle('workvivo:cancelPost', async (_e, clipId: string) => {
    runningWorkvivoPosts.get(clipId)?.abort()
  })

  ipcMain.handle('video:timeline', async (_e, videoPath: string, startSec: number, endSec: number) => {
    // Same trust boundary as media://: only registered project media.
    if (!isMediaPathAllowed(videoPath)) throw new Error('Not a project video')
    return getTimeline(videoPath, startSec, endSec)
  })

  ipcMain.handle('settings:downloadGpuFfmpeg', async (event) => {
    return downloadGpuFfmpeg((p) => {
      if (!event.sender.isDestroyed()) event.sender.send('gpu:progress', p)
    })
  })

  ipcMain.handle('settings:get', async () => getSettings())
  ipcMain.handle('settings:update', async (_e, update: SettingsUpdate) => updateSettings(update))

  ipcMain.handle('fonts:list', async () => listCustomFonts())

  ipcMain.handle('fonts:add', async (event) => {
    // Headless/CI hook (like CLIPFORGE_SELECT_VIDEO): skip the native dialog.
    let paths: string[]
    if (process.env.CLIPFORGE_SELECT_FONTS) {
      paths = process.env.CLIPFORGE_SELECT_FONTS.split(',')
    } else {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win!, {
        title: 'Choose font files',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Fonts', extensions: ['ttf', 'otf'] }]
      })
      if (result.canceled) return listCustomFonts()
      paths = result.filePaths
    }
    return addCustomFonts(paths)
  })

  ipcMain.handle('fonts:remove', async (_e, fileName: string) => removeCustomFont(fileName))

  ipcMain.handle('cookies:import', async (event) => {
    if (process.env.CLIPFORGE_COOKIES_FILE) {
      await installImportCookiesFile(process.env.CLIPFORGE_COOKIES_FILE)
      return getSettings()
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import cookies file',
      properties: ['openFile'],
      filters: [{ name: 'Cookies', extensions: ['txt'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return getSettings()
    await installImportCookiesFile(result.filePaths[0])
    return getSettings()
  })

  ipcMain.handle('cookies:clear', async () => {
    await clearImportCookiesFile()
    return getSettings()
  })

  ipcMain.handle('branding:selectLogo', async (event) => {
    // Headless/CI hook: skip the native dialog.
    let picked: string | null
    if (process.env.CLIPFORGE_SELECT_LOGO) {
      picked = process.env.CLIPFORGE_SELECT_LOGO
    } else {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win!, {
        title: 'Choose a watermark or logo image',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
      })
      picked = result.canceled ? null : result.filePaths[0]
    }
    if (!picked) return getSettings()

    // Copy into userData so the logo survives the source file moving and is
    // reachable through the media:// allowlist for the preview.
    const dir = join(app.getPath('userData'), 'branding')
    await mkdir(dir, { recursive: true })
    const dest = join(dir, `logo-${Date.now()}${extname(picked).toLowerCase()}`)
    await copyFile(picked, dest)
    const previous = getBrandingSettings().imagePath
    if (previous && previous.startsWith(dir) && basename(previous) !== basename(dest)) {
      await rm(previous, { force: true }).catch(() => undefined)
    }
    return updateSettings({ branding: { imagePath: dest, enabled: true } })
  })

  ipcMain.handle('updates:check', async () => checkForUpdates())

  ipcMain.handle('updates:download', async (event) => {
    return downloadUpdate((p) => {
      if (!event.sender.isDestroyed()) event.sender.send('update:downloadProgress', p)
    })
  })

  ipcMain.handle('updates:install', async () => installUpdate())

  ipcMain.handle('updates:updateFromSource', async (event) => {
    return updateFromSource((p) => {
      if (!event.sender.isDestroyed()) event.sender.send('update:sourceProgress', p)
    })
  })

  ipcMain.handle('shell:showItemInFolder', async (_e, path: string) => {
    shell.showItemInFolder(path)
  })
}
