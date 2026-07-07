import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AnalyzeOptions,
  AppSettings,
  Clip,
  CustomFont,
  ExportOptions,
  ExportProgress,
  ExportResult,
  GpuEncoderStatus,
  ImportProgress,
  PipelineProgress,
  Project,
  ProjectSummary,
  SettingsUpdate,
  TimelineData,
  UpdateCheckResult,
  UpdateDownloadProgress,
  WorkvivoPostProgress,
  WorkvivoPostResult,
  WorkvivoSpace,
  WorkvivoTestResult
} from '@shared/types'

const api = {
  selectVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectVideo'),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),

  createProject: (videoPath: string): Promise<Project> => ipcRenderer.invoke('project:create', videoPath),
  createProjectFromUrl: (url: string): Promise<Project> =>
    ipcRenderer.invoke('project:createFromUrl', url),
  analyzeProject: (projectId: string, options: AnalyzeOptions): Promise<Project> =>
    ipcRenderer.invoke('project:analyze', projectId, options),
  cancelAnalyze: (projectId: string): Promise<void> =>
    ipcRenderer.invoke('project:cancelAnalyze', projectId),
  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
  loadProject: (id: string): Promise<Project> => ipcRenderer.invoke('project:load', id),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke('project:delete', id),
  renameProject: (id: string, name: string): Promise<Project> => ipcRenderer.invoke('project:rename', id, name),
  relinkVideo: (projectId: string): Promise<Project> =>
    ipcRenderer.invoke('project:relinkVideo', projectId),
  updateClip: (projectId: string, clip: Clip): Promise<Project> =>
    ipcRenderer.invoke('project:updateClip', projectId, clip),
  updateTranscriptWord: (
    projectId: string,
    segmentId: number,
    wordIndex: number,
    text: string
  ): Promise<Project> =>
    ipcRenderer.invoke('project:updateTranscriptWord', projectId, segmentId, wordIndex, text),

  exportClip: (projectId: string, opts: ExportOptions): Promise<ExportResult> =>
    ipcRenderer.invoke('clip:export', projectId, opts),
  cancelExport: (clipId: string): Promise<void> => ipcRenderer.invoke('clip:cancelExport', clipId),
  generateCaption: (projectId: string, clipId: string): Promise<Project> =>
    ipcRenderer.invoke('clip:generateCaption', projectId, clipId),

  generateWorkvivoCaption: (projectId: string, clipId: string): Promise<Project> =>
    ipcRenderer.invoke('workvivo:generateCaption', projectId, clipId),
  testWorkvivo: (): Promise<WorkvivoTestResult> => ipcRenderer.invoke('workvivo:testConnection'),
  listWorkvivoSpaces: (): Promise<WorkvivoSpace[]> => ipcRenderer.invoke('workvivo:listSpaces'),
  findWorkvivoUser: (email: string): Promise<{ id: string; name: string }> =>
    ipcRenderer.invoke('workvivo:findUser', email),
  postClipToWorkvivo: (
    projectId: string,
    clipId: string,
    spaceId: string
  ): Promise<WorkvivoPostResult> =>
    ipcRenderer.invoke('workvivo:postClip', projectId, clipId, spaceId),
  cancelWorkvivoPost: (clipId: string): Promise<void> =>
    ipcRenderer.invoke('workvivo:cancelPost', clipId),
  onWorkvivoProgress: (cb: (p: WorkvivoPostProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: WorkvivoPostProgress): void => cb(p)
    ipcRenderer.on('workvivo:progress', listener)
    return () => ipcRenderer.removeListener('workvivo:progress', listener)
  },

  getTimeline: (videoPath: string, startSec: number, endSec: number): Promise<TimelineData> =>
    ipcRenderer.invoke('video:timeline', videoPath, startSec, endSec),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (update: SettingsUpdate): Promise<AppSettings> => ipcRenderer.invoke('settings:update', update),
  listFonts: (): Promise<CustomFont[]> => ipcRenderer.invoke('fonts:list'),
  addFonts: (): Promise<CustomFont[]> => ipcRenderer.invoke('fonts:add'),
  removeFont: (fileName: string): Promise<CustomFont[]> => ipcRenderer.invoke('fonts:remove', fileName),
  importCookiesFile: (): Promise<AppSettings> => ipcRenderer.invoke('cookies:import'),
  clearCookiesFile: (): Promise<AppSettings> => ipcRenderer.invoke('cookies:clear'),
  selectBrandingLogo: (): Promise<AppSettings> => ipcRenderer.invoke('branding:selectLogo'),
  checkForUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('updates:check'),
  downloadUpdate: (): Promise<string> => ipcRenderer.invoke('updates:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('updates:install'),
  updateFromSource: (): Promise<void> => ipcRenderer.invoke('updates:updateFromSource'),
  onSourceUpdateProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ImportProgress): void => cb(p)
    ipcRenderer.on('update:sourceProgress', listener)
    return () => ipcRenderer.removeListener('update:sourceProgress', listener)
  },
  onUpdateDownloadProgress: (cb: (p: UpdateDownloadProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: UpdateDownloadProgress): void => cb(p)
    ipcRenderer.on('update:downloadProgress', listener)
    return () => ipcRenderer.removeListener('update:downloadProgress', listener)
  },
  downloadGpuFfmpeg: (): Promise<GpuEncoderStatus> => ipcRenderer.invoke('settings:downloadGpuFfmpeg'),
  onGpuProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ImportProgress): void => cb(p)
    ipcRenderer.on('gpu:progress', listener)
    return () => ipcRenderer.removeListener('gpu:progress', listener)
  },

  showItemInFolder: (path: string): Promise<void> => ipcRenderer.invoke('shell:showItemInFolder', path),

  onPipelineProgress: (cb: (p: PipelineProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: PipelineProgress): void => cb(p)
    ipcRenderer.on('pipeline:progress', listener)
    return () => ipcRenderer.removeListener('pipeline:progress', listener)
  },
  onExportProgress: (cb: (p: ExportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ExportProgress): void => cb(p)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
  onImportProgress: (cb: (p: ImportProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ImportProgress): void => cb(p)
    ipcRenderer.on('import:progress', listener)
    return () => ipcRenderer.removeListener('import:progress', listener)
  },

  /** Build a media:// URL the renderer can use in <video>/<img> tags. */
  mediaUrl: (absolutePath: string): string => `media://file/${encodeURIComponent(absolutePath)}`,

  /**
   * Absolute path for a dropped File. Electron removed File.path under the
   * sandbox, so drag-and-drop has to resolve the path through webUtils here in
   * the preload rather than reading it off the File in the renderer.
   */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  /** OS platform, for platform-specific chrome (mac vibrancy, drag regions). */
  platform: process.env.CLIPFORGE_FORCE_GLASS ? 'darwin' : process.platform
}

export type ClipForgeApi = typeof api

contextBridge.exposeInMainWorld('clipforge', api)
