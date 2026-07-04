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

/** Auto = follow the AI face track; manual = fixed focusX slider. */
export type FramingMode = 'auto' | 'manual'

/** One step of the piecewise-constant focus track (t in source seconds). */
export interface FocusKeyframe {
  t: number
  /** Horizontal face centre, 0 = far left, 1 = far right. */
  x: number
}

export interface ClipEditState {
  aspect: AspectRatio
  reframeMode: ReframeMode
  framing: FramingMode
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
  /** AI face track for auto reframing; null when no usable faces were found. */
  focusTrack: FocusKeyframe[] | null
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
  | 'reframe'
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

export type EncoderPreference = 'auto' | 'cpu' | 'gpu'
export type QualityPreference = 'draft' | 'standard' | 'high'

export interface GpuEncoderStatus {
  /** True when a working hardware encoder was verified with a test encode. */
  available: boolean
  /** Human-readable status, e.g. "NVENC ready via system ffmpeg". */
  detail: string
  /** True when a GPU-capable ffmpeg build can be downloaded to enable it. */
  canDownloadFfmpeg: boolean
}

export interface AppSettings {
  /** Masked key for display, e.g. "sk-...abcd". Empty string when unset. */
  apiKeyMasked: string
  hasApiKey: boolean
  transcriptionModel: string
  analysisModel: string
  encoder: EncoderPreference
  quality: QualityPreference
  gpu: GpuEncoderStatus
}

export interface SettingsUpdate {
  apiKey?: string
  transcriptionModel?: string
  analysisModel?: string
  encoder?: EncoderPreference
  quality?: QualityPreference
}

export interface PipelineError {
  message: string
  stage: PipelineStage
}

export interface ImportProgress {
  /** 0..1, or -1 when indeterminate. */
  progress: number
  message: string
}
