/** Shared domain types used across main, preload and renderer. */

export interface VideoInfo {
  path: string
  fileName: string
  durationSec: number
  width: number
  height: number
  fps: number
  sizeBytes: number
  hasAudio: boolean
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
  /** Relative vocal energy 0..1 (percentile within this video); optional. */
  energy?: number
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

/** One step of the focus track (t in source seconds). */
export interface FocusKeyframe {
  t: number
  /**
   * Horizontal face centre in the source frame, 0 = far left, 1 = far right.
   * Export recentres the crop on this point (see faceCentreCropLeft).
   */
  x: number
  /**
   * True when this keyframe lands on a camera cut or speaker switch, where
   * the crop must snap instantly. Absent/false keyframes are within-shot
   * moves of the same person, which the crop reaches with a smooth pan.
   */
  cut?: boolean
}

export interface ClipEditState {
  aspect: AspectRatio
  reframeMode: ReframeMode
  framing: FramingMode
  /** Remove long pauses and filler words ("um", "uh") from the clip. */
  tightenCuts: boolean
  /**
   * Scene-aware auto zoom: jump zooms covering tighten-cut joins, fast
   * punch-ins on energetic lines, slow creep on long static stretches.
   */
  autoZoom?: boolean
  /** Manual crop slider: 0 = far left, 0.5 = frame centre, 1 = far right. */
  focusX: number
  captionsEnabled: boolean
  captionStyleId: string
  /** Font family overriding the style's font (a custom uploaded font); null/absent = style default. */
  captionFontFamily?: string | null
  showTitle: boolean
  /** Trim overrides (absolute seconds in the source video). */
  start: number
  end: number
}

/** How a B-roll image is composited over the clip. */
export type BrollMode = 'fullscreen' | 'overlay'

export interface BrollItem {
  id: string
  /** The spoken word/phrase that triggered this insert, e.g. "Yoda". */
  trigger: string
  /** Image search query used, e.g. "Yoda Star Wars character". */
  query: string
  /** Absolute source-video seconds. */
  start: number
  end: number
  mode: BrollMode
  /** Local path of the downloaded image; null if no image was found. */
  imagePath: string | null
  /** Where the image came from (page URL) for attribution. */
  sourceUrl: string
  enabled: boolean
}

export interface Clip {
  id: string
  /** AI suggested boundaries (absolute seconds in the source video). */
  suggestedStart: number
  suggestedEnd: number
  title: string
  hook: string
  summary: string
  /** AI-generated social post caption (TikTok-style); null until generated. */
  caption?: string | null
  /**
   * AI-generated caption for internal WorkVivo posts (brand-voiced, not
   * hashtag-led); null until generated. Kept separate from `caption` because
   * the two registers differ. Falls back to `caption`/`title` when unset.
   */
  workvivoCaption?: string | null
  viralityScore: number
  viralityReason: string
  /** One-line LLM assessment of what the visuals add/cost; null until scored. */
  visualSummary: string | null
  hashtags: string[]
  thumbnailPath: string | null
  /** AI face track for auto reframing; null when no usable faces were found. */
  focusTrack: FocusKeyframe[] | null
  /** AI-suggested image inserts timed to spoken keywords. */
  broll: BrollItem[]
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
  /**
   * True when the source video no longer exists on disk (moved/deleted).
   * Transient — recomputed on load, never persisted.
   */
  sourceMissing?: boolean
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
  | 'broll'
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
  /** Generate AI B-roll image inserts timed to spoken keywords. */
  broll: boolean
  /** Trim each clip's start so it opens on its hook line instead of setup. */
  hookFirst: boolean
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

/** Corner where the branding watermark is composited. */
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/**
 * Saved brand palette applied as defaults across caption styles when enabled.
 * Primary is the main pop colour (word highlight or pill fill); secondary is
 * the active-word text on pill/box presets.
 */
export interface BrandColors {
  enabled: boolean
  primaryColor: string
  secondaryColor: string
  /** When set, overrides the preset base caption text colour. */
  textColor: string | null
  /** When set, overrides the preset caption outline colour. */
  outlineColor: string | null
  hookTextColor: string
  hookBackgroundColor: string
}

/**
 * Editable brand tone-of-voice and style guidance that steers AI caption
 * generation (used for WorkVivo captions today, and available to any future
 * generated copy). All fields are free text; an empty string means "no
 * preference" and the generator falls back to sensible defaults.
 */
export interface BrandVoiceSettings {
  /** Organisation/brand name, woven into captions where it reads naturally. */
  brandName: string
  /** How the brand should sound, e.g. "warm, upbeat, human, never salesy". */
  tone: string
  /** Writing style/format rules, e.g. "British English, short sentences, no emojis". */
  style: string
  /** Things to avoid, e.g. "no hashtags, no hype, no corporate jargon". */
  avoid: string
}

/** App-wide branding applied to the preview and burned into exports. */
export interface BrandingSettings {
  enabled: boolean
  /** Absolute path of the watermark/logo image (copied into userData); null = none. */
  imagePath: string | null
  position: WatermarkPosition
  /** 0..1 watermark opacity. */
  opacity: number
  /** Watermark width as a fraction of the output video width. */
  scale: number
  colors: BrandColors
}

/**
 * Browser whose cookie store yt-dlp borrows for URL imports that need a
 * login (private/unlisted videos, enterprise Vimeo behind SSO). Empty string
 * = no login. Values map 1:1 to yt-dlp's --cookies-from-browser.
 */
export type BrowserCookieSource =
  | ''
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'brave'
  | 'opera'
  | 'vivaldi'
  | 'safari'

/** Result of comparing the running app against the latest GitHub release. */
export interface UpdateCheckResult {
  currentVersion: string
  /** Version of the latest published release; null when none exist. */
  latestVersion: string | null
  updateAvailable: boolean
  /** GitHub release page to download the update from. */
  releaseUrl: string | null
  /**
   * True when the app can download and install the update itself (packaged
   * build). False when running from a source checkout, where updating means
   * pulling and rebuilding.
   */
  autoUpdateSupported: boolean
  /**
   * True when this copy is a git checkout the app can update in place by
   * pulling and rebuilding itself (the one-click path for source installs).
   */
  sourceUpdateSupported: boolean
  /** Human-readable failure (offline, rate limited); null on success. */
  error: string | null
  checkedAt: number
}

/** Renderer-facing state of an in-app update download. */
export interface UpdateDownloadProgress {
  /** 0..1 downloaded fraction. */
  progress: number
}

/** A user-uploaded caption font stored in userData/fonts. */
export interface CustomFont {
  /** Family name parsed from the font file (what libass and CSS match on). */
  family: string
  fileName: string
  /** Absolute path for renderer @font-face loading via media://. */
  path: string
}

export interface GpuEncoderStatus {
  /** True when a working hardware encoder was verified with a test encode. */
  available: boolean
  /** Human-readable status, e.g. "NVENC ready via system ffmpeg". */
  detail: string
  /** True when a GPU-capable ffmpeg build can be downloaded to enable it. */
  canDownloadFfmpeg: boolean
}

/** A WorkVivo space (audience) a clip can be posted to. */
export interface WorkvivoSpace {
  id: string
  name: string
}

/**
 * Renderer-facing WorkVivo connection state. The Bearer token itself is never
 * exposed — only whether one is stored and a masked hint, mirroring how the
 * OpenAI key is surfaced.
 */
export interface WorkvivoPublicSettings {
  /** Org WorkVivo URL, e.g. https://acme.workvivo.com. */
  url: string
  /** Organisation ID sent as the `Workvivo-Id` header. */
  companyId: string
  /** WorkVivo user id posts are attributed to (empty = the token's own user). */
  postAsUserId: string
  /** Preferred default space id for one-click posting ('' = none). */
  defaultSpaceId: string
  hasToken: boolean
  tokenMasked: string
  /** True when url + companyId + token are all present. */
  configured: boolean
}

/** Partial WorkVivo config update; token is write-only. */
export interface WorkvivoSettingsUpdate {
  url?: string
  companyId?: string
  token?: string
  postAsUserId?: string
  defaultSpaceId?: string
}

/** Outcome of a WorkVivo "Test connection" call. */
export interface WorkvivoTestResult {
  ok: boolean
  message: string
  /** Number of spaces the token can see, when the test succeeded. */
  spaceCount?: number
}

/** Outcome of posting a clip to WorkVivo. */
export interface WorkvivoPostResult {
  ok: boolean
  /** Link to the created post, when WorkVivo returned one. */
  permalink: string | null
}

/** Progress while rendering + uploading a clip to WorkVivo. */
export interface WorkvivoPostProgress {
  clipId: string
  /** 0..1 overall (render then upload), or -1 when indeterminate. */
  progress: number
  message: string
}

export interface AppSettings {
  /** Masked key for display, e.g. "sk-...abcd". Empty string when unset. */
  apiKeyMasked: string
  hasApiKey: boolean
  /**
   * True when the OS keychain (Electron safeStorage) protects the API key;
   * false when it is stored only obfuscated on disk (e.g. headless Linux).
   */
  keyStorageSecure: boolean
  transcriptionModel: string
  /**
   * Language for Whisper transcription: an ISO-639-1 code (e.g. 'en') that is
   * sent to Whisper so it does not auto-detect and occasionally guess wrong
   * (e.g. labelling English as Welsh). 'auto' lets Whisper detect per video.
   */
  transcriptionLanguage: string
  analysisModel: string
  encoder: EncoderPreference
  quality: QualityPreference
  gpu: GpuEncoderStatus
  branding: BrandingSettings
  brandVoice: BrandVoiceSettings
  appVersion: string
  /** Browser to borrow login cookies from for URL imports ('' = none). */
  importCookiesBrowser: BrowserCookieSource
  /** True when a Netscape cookies.txt file is stored for URL imports. */
  hasImportCookiesFile: boolean
  /** WorkVivo posting integration. */
  workvivo: WorkvivoPublicSettings
}

export interface SettingsUpdate {
  apiKey?: string
  transcriptionModel?: string
  transcriptionLanguage?: string
  analysisModel?: string
  encoder?: EncoderPreference
  quality?: QualityPreference
  branding?: Partial<BrandingSettings>
  brandVoice?: Partial<BrandVoiceSettings>
  importCookiesBrowser?: BrowserCookieSource
  clearImportCookiesFile?: boolean
  workvivo?: WorkvivoSettingsUpdate
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

/** Editor timeline data for a window of the source video. */
export interface TimelineData {
  /** Absolute paths of filmstrip frames, in time order. */
  frames: string[]
  /** Normalised 0..1 RMS per bucket across the window (empty when no audio). */
  waveform: number[]
}
