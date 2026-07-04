/** Shared domain types used across main, preload and renderer. */

export interface VideoInfo {
  path: string
  fileName: string
  durationSec: number
  width: number
  height: number
  fps: number
  sizeBytes: number
}

export interface TranscriptWord {
  text: string
  start: number
  end: number
}

export interface TranscriptSegment {
  id: number
  text: string
  start: number
  end: number
  words: TranscriptWord[]
}

export interface Transcript {
  language: string
  durationSec: number
  segments: TranscriptSegment[]
}

export type AspectRatio = '9:16' | '1:1' | '16:9' | 'original'

/** How the source frame is fitted into the target aspect ratio. */
export type ReframeMode = 'crop' | 'fit-blur'

export interface ClipEditState {
  aspect: AspectRatio
  reframeMode: ReframeMode
  /** Horizontal focus for cropping, 0 = far left, 0.5 = centre, 1 = far right. */
  focusX: number
  captionsEnabled: boolean
  captionStyleId: string
  showTitle: boolean
  /** Trim overrides (absolute seconds in the source video). */
  start: number
  end: number
}

export interface Clip {
  id: string
  /** AI suggested boundaries (absolute seconds in the source video). */
  suggestedStart: number
  suggestedEnd: number
  title: string
  hook: string
  summary: string
  viralityScore: number
  viralityReason: string
  hashtags: string[]
  thumbnailPath: string | null
  edit: ClipEditState
}

export interface Project {
  id: string
  createdAt: number
  updatedAt: number
  name: string
  video: VideoInfo
  transcript: Transcript | null
  clips: Clip[]
  /** Custom instructions the user gave the AI, if any. */
  prompt: string
}

export interface ProjectSummary {
  id: string
  createdAt: number
  updatedAt: number
  name: string
  videoPath: string
  videoFileName: string
  durationSec: number
  clipCount: number
  thumbnailPath: string | null
}

export type PipelineStage =
  | 'probe'
  | 'audio'
  | 'transcribe'
  | 'analyze'
  | 'thumbnails'
  | 'done'

export interface PipelineProgress {
  stage: PipelineStage
  /** 0..1 within the whole pipeline. */
  progress: number
  message: string
}

export interface AnalyzeOptions {
  /** Optional user steering prompt ("ClipAnything" style). */
  prompt: string
  clipLength: ClipLengthPreference
}

export type ClipLengthPreference = 'auto' | 'short' | 'medium' | 'long'

export interface ExportOptions {
  clipId: string
  /** Target directory; a file name is derived from the clip title. */
  outputDir: string
}

export interface ExportProgress {
  clipId: string
  progress: number
  message: string
}

export interface ExportResult {
  clipId: string
  outputPath: string
}

export interface AppSettings {
  /** Masked key for display, e.g. "sk-...abcd". Empty string when unset. */
  apiKeyMasked: string
  hasApiKey: boolean
  transcriptionModel: string
  analysisModel: string
}

export interface SettingsUpdate {
  apiKey?: string
  transcriptionModel?: string
  analysisModel?: string
}

export interface PipelineError {
  message: string
  stage: PipelineStage
}
