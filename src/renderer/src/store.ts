import { create } from 'zustand'
import type {
  AnalyzeOptions,
  AppSettings,
  Clip,
  CustomFont,
  ImportProgress,
  PipelineProgress,
  Project,
  ProjectSummary,
  SettingsUpdate,
  UpdateCheckResult
} from '@shared/types'

/** Font faces already registered with document.fonts (FontFace API). */
const loadedFontFaces = new Map<string, FontFace>()

/** Register custom fonts with the renderer so previews match exports. */
async function registerFonts(fonts: CustomFont[]): Promise<void> {
  for (const f of fonts) {
    if (loadedFontFaces.has(f.family)) continue
    try {
      const face = new FontFace(f.family, `url("${window.clipforge.mediaUrl(f.path)}")`)
      await face.load()
      document.fonts.add(face)
      loadedFontFaces.set(f.family, face)
    } catch {
      /* unloadable font: preview falls back to sans-serif */
    }
  }
}

function unregisterFontFamily(family: string): void {
  const face = loadedFontFaces.get(family)
  if (!face) return
  document.fonts.delete(face)
  loadedFontFaces.delete(family)
}

export type Screen = 'home' | 'processing' | 'clips' | 'editor'

export interface ExportEntry {
  status: 'exporting' | 'done' | 'error'
  progress: number
  outputPath?: string
  error?: string
}

interface AppState {
  screen: Screen
  project: Project | null
  projects: ProjectSummary[]
  settings: AppSettings | null
  settingsOpen: boolean
  pipelineProgress: PipelineProgress | null
  pipelineError: string | null
  importProgress: ImportProgress | null
  selectedClipId: string | null
  exports: Record<string, ExportEntry>
  exportDir: string | null
  customFonts: CustomFont[]
  updateCheck: UpdateCheckResult | null
  checkingForUpdates: boolean
  updateDownload: {
    status: 'idle' | 'downloading' | 'downloaded' | 'error'
    progress: number
    error?: string
  }

  init: () => Promise<void>
  refreshProjects: () => Promise<void>
  importVideo: () => Promise<void>
  importVideoFromUrl: (url: string) => Promise<void>
  openProject: (id: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  relinkVideo: () => Promise<void>
  goHome: () => void
  setSettingsOpen: (open: boolean) => void
  saveSettings: (update: SettingsUpdate) => Promise<void>
  refreshSettings: () => Promise<void>
  analyze: (options: AnalyzeOptions) => Promise<void>
  cancelAnalyze: () => Promise<void>
  openEditor: (clipId: string) => void
  closeEditor: () => void
  updateClip: (clip: Clip) => Promise<void>
  updateClipLocal: (clip: Clip) => void
  generateCaption: (clipId: string) => Promise<void>
  captionBusy: Record<string, boolean>
  updateTranscriptWord: (segmentId: number, wordIndex: number, text: string) => Promise<void>
  exportClip: (clipId: string) => Promise<void>
  cancelExport: (clipId: string) => Promise<void>
  exportAll: () => Promise<void>
  chooseExportDir: () => Promise<void>
  clearExport: (clipId: string) => void
  addFonts: () => Promise<void>
  removeFont: (fileName: string) => Promise<void>
  selectBrandingLogo: () => Promise<void>
  checkForUpdates: (silent?: boolean) => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
}

export const useStore = create<AppState>((set, get) => ({
  screen: 'home',
  project: null,
  projects: [],
  settings: null,
  settingsOpen: false,
  pipelineProgress: null,
  pipelineError: null,
  importProgress: null,
  selectedClipId: null,
  exports: {},
  exportDir: null,
  customFonts: [],
  updateCheck: null,
  checkingForUpdates: false,
  updateDownload: { status: 'idle', progress: 0 },
  captionBusy: {},

  init: async () => {
    const [settings, projects, customFonts] = await Promise.all([
      window.clipforge.getSettings(),
      window.clipforge.listProjects(),
      window.clipforge.listFonts()
    ])
    set({ settings, projects, customFonts })
    void registerFonts(customFonts)
    // Automatic update check on launch; failures stay silent here and are
    // only surfaced when the user checks manually from Settings.
    void get().checkForUpdates(true)
    window.clipforge.onPipelineProgress((p) => set({ pipelineProgress: p }))
    window.clipforge.onImportProgress((p) => {
      if (get().importProgress !== null) set({ importProgress: p })
    })
    window.clipforge.onExportProgress((p) => {
      const entry = get().exports[p.clipId]
      if (entry?.status === 'exporting') {
        set({ exports: { ...get().exports, [p.clipId]: { ...entry, progress: p.progress } } })
      }
    })
  },

  refreshProjects: async () => {
    set({ projects: await window.clipforge.listProjects() })
  },

  importVideo: async () => {
    const path = await window.clipforge.selectVideo()
    if (!path) return
    const project = await window.clipforge.createProject(path)
    set({ project, screen: 'home', pipelineError: null })
    await get().refreshProjects()
  },

  importVideoFromUrl: async (url) => {
    set({ importProgress: { progress: -1, message: 'Starting…' }, pipelineError: null })
    try {
      const project = await window.clipforge.createProjectFromUrl(url.trim())
      set({ project, screen: 'home', importProgress: null })
      await get().refreshProjects()
    } catch (err) {
      set({
        importProgress: null,
        pipelineError: err instanceof Error ? cleanIpcError(err.message) : String(err)
      })
    }
  },

  openProject: async (id) => {
    const project = await window.clipforge.loadProject(id)
    set({
      project,
      screen: project.clips.length > 0 ? 'clips' : 'home',
      selectedClipId: null,
      pipelineError: null
    })
  },

  deleteProject: async (id) => {
    await window.clipforge.deleteProject(id)
    if (get().project?.id === id) set({ project: null, screen: 'home' })
    await get().refreshProjects()
  },

  relinkVideo: async () => {
    const project = get().project
    if (!project) return
    try {
      const updated = await window.clipforge.relinkVideo(project.id)
      set({ project: updated, pipelineError: null })
    } catch (err) {
      set({ pipelineError: err instanceof Error ? cleanIpcError(err.message) : String(err) })
    }
  },

  goHome: () => set({ screen: 'home', selectedClipId: null, pipelineError: null }),

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  saveSettings: async (update) => {
    const settings = await window.clipforge.updateSettings(update)
    set({ settings })
  },

  refreshSettings: async () => {
    set({ settings: await window.clipforge.getSettings() })
  },

  analyze: async (options) => {
    const project = get().project
    if (!project) return
    set({
      screen: 'processing',
      pipelineError: null,
      pipelineProgress: { stage: 'audio', progress: 0, message: 'Starting…' }
    })
    try {
      const updated = await window.clipforge.analyzeProject(project.id, options)
      set({ project: updated, screen: 'clips', pipelineProgress: null })
    } catch (err) {
      const message = err instanceof Error ? cleanIpcError(err.message) : String(err)
      const cancelled = message.includes('Analysis cancelled')
      // Pick up any checkpoint (e.g. saved transcript) the failed run left.
      const reloaded = await window.clipforge.loadProject(project.id).catch(() => project)
      set({
        project: reloaded,
        screen: 'home',
        pipelineProgress: null,
        pipelineError: cancelled ? null : message
      })
    }
    await get().refreshProjects()
  },

  cancelAnalyze: async () => {
    const project = get().project
    if (project) await window.clipforge.cancelAnalyze(project.id)
  },

  openEditor: (clipId) => set({ selectedClipId: clipId, screen: 'editor' }),
  closeEditor: () => set({ selectedClipId: null, screen: 'clips' }),

  updateClipLocal: (clip) => {
    const project = get().project
    if (!project) return
    set({
      project: { ...project, clips: project.clips.map((c) => (c.id === clip.id ? clip : c)) }
    })
  },

  updateClip: async (clip) => {
    const project = get().project
    if (!project) return
    get().updateClipLocal(clip)
    await window.clipforge.updateClip(project.id, clip)
  },

  generateCaption: async (clipId) => {
    const project = get().project
    if (!project || get().captionBusy[clipId]) return
    set({ captionBusy: { ...get().captionBusy, [clipId]: true } })
    try {
      const updated = await window.clipforge.generateCaption(project.id, clipId)
      const fresh = updated.clips.find((c) => c.id === clipId)
      const current = get().project
      // Only graft the caption on: other clip edits may be in flight.
      if (fresh && current?.id === updated.id) {
        set({
          project: {
            ...current,
            clips: current.clips.map((c) =>
              c.id === clipId ? { ...c, caption: fresh.caption } : c
            )
          }
        })
      }
    } finally {
      const busy = { ...get().captionBusy }
      delete busy[clipId]
      set({ captionBusy: busy })
    }
  },

  updateTranscriptWord: async (segmentId, wordIndex, text) => {
    const project = get().project
    if (!project) return
    const updated = await window.clipforge.updateTranscriptWord(
      project.id,
      segmentId,
      wordIndex,
      text
    )
    // Only replace the transcript: clip edits in flight must not be clobbered.
    const current = get().project
    if (current?.id === updated.id) {
      set({ project: { ...current, transcript: updated.transcript } })
    }
  },

  exportClip: async (clipId) => {
    const project = get().project
    if (!project) return
    let dir = get().exportDir
    if (!dir) {
      dir = await window.clipforge.selectDirectory()
      if (!dir) return
      set({ exportDir: dir })
    }
    set({ exports: { ...get().exports, [clipId]: { status: 'exporting', progress: 0 } } })
    try {
      const result = await window.clipforge.exportClip(project.id, { clipId, outputDir: dir })
      set({
        exports: {
          ...get().exports,
          [clipId]: { status: 'done', progress: 1, outputPath: result.outputPath }
        }
      })
    } catch (err) {
      const message = err instanceof Error ? cleanIpcError(err.message) : String(err)
      if (message.includes('Export cancelled')) {
        get().clearExport(clipId)
        return
      }
      set({
        exports: {
          ...get().exports,
          [clipId]: { status: 'error', progress: 0, error: message }
        }
      })
    }
  },

  cancelExport: async (clipId) => {
    await window.clipforge.cancelExport(clipId)
  },

  exportAll: async () => {
    const project = get().project
    if (!project) return
    for (const clip of project.clips) {
      const status = get().exports[clip.id]?.status
      if (status === 'exporting' || status === 'done') continue
      await get().exportClip(clip.id)
      // The folder picker was dismissed — don't re-prompt for every clip.
      if (!get().exportDir) return
    }
  },

  chooseExportDir: async () => {
    const dir = await window.clipforge.selectDirectory()
    if (dir) set({ exportDir: dir })
  },

  clearExport: (clipId) => {
    const exports = { ...get().exports }
    delete exports[clipId]
    set({ exports })
  },

  addFonts: async () => {
    const customFonts = await window.clipforge.addFonts()
    set({ customFonts })
    await registerFonts(customFonts)
  },

  removeFont: async (fileName) => {
    const removed = get().customFonts.find((f) => f.fileName === fileName)
    const customFonts = await window.clipforge.removeFont(fileName)
    if (removed && !customFonts.some((f) => f.family === removed.family)) {
      unregisterFontFamily(removed.family)
    }
    set({ customFonts })
  },

  selectBrandingLogo: async () => {
    set({ settings: await window.clipforge.selectBrandingLogo() })
  },

  checkForUpdates: async (silent = false) => {
    if (get().checkingForUpdates) return
    set({ checkingForUpdates: true })
    try {
      const updateCheck = await window.clipforge.checkForUpdates()
      if (!silent || !updateCheck.error) set({ updateCheck })
    } finally {
      set({ checkingForUpdates: false })
    }
  },

  downloadUpdate: async () => {
    if (get().updateDownload.status === 'downloading') return
    set({ updateDownload: { status: 'downloading', progress: 0 } })
    const unsubscribe = window.clipforge.onUpdateDownloadProgress((p) => {
      if (get().updateDownload.status === 'downloading') {
        set({ updateDownload: { status: 'downloading', progress: p.progress } })
      }
    })
    try {
      await window.clipforge.downloadUpdate()
      set({ updateDownload: { status: 'downloaded', progress: 1 } })
    } catch (err) {
      set({
        updateDownload: {
          status: 'error',
          progress: 0,
          error: err instanceof Error ? cleanIpcError(err.message) : String(err)
        }
      })
    } finally {
      unsubscribe()
    }
  },

  installUpdate: async () => {
    await window.clipforge.installUpdate()
  }
}))

/** Electron prefixes IPC errors with "Error invoking remote method '...': Error:". */
function cleanIpcError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}
