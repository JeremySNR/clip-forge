import { contextBridge, ipcRenderer } from 'electron'
import type {
  AnalyzeOptions,
  AppSettings,
  Clip,
  ExportOptions,
  ExportProgress,
  ExportResult,
  ImportProgress,
  PipelineProgress,
  Project,
  ProjectSummary,
  SettingsUpdate
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
  updateClip: (projectId: string, clip: Clip): Promise<Project> =>
    ipcRenderer.invoke('project:updateClip', projectId, clip),

  exportClip: (projectId: string, opts: ExportOptions): Promise<ExportResult> =>
    ipcRenderer.invoke('clip:export', projectId, opts),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (update: SettingsUpdate): Promise<AppSettings> => ipcRenderer.invoke('settings:update', update),

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
  mediaUrl: (absolutePath: string): string => `media://file/${encodeURIComponent(absolutePath)}`
}

export type ClipForgeApi = typeof api

contextBridge.exposeInMainWorld('clipforge', api)
