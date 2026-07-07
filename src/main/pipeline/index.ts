import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { AnalyzeOptions, BrowserCookieSource, ImportProgress, PipelineProgress, Project } from '@shared/types'
import { mapLimit } from './concurrency'
import { extractAudioChunks, extractThumbnail, probeVideo } from './ffmpeg'
import { transcribeChunks } from './transcribe'
import { detectHighlights } from './highlights'
import { analyzeClipFocus, applyFocusAnalysis } from './faces'
import { shouldAnalyzeFaces } from '@shared/videoType'
import { annotateEnergy } from './energy'
import { assessClipVisuals, ensembleScore } from './visualScore'
import { attachBroll } from './broll'
import {
  assertCookieAuthSupported,
  cookieCopyErrorHint,
  cookieDpapiErrorHint,
  downloadUrlVideo,
  ensureYtDlp,
  fetchUrlMeta,
  isAuthError,
  isCookieCopyError,
  isDpapiDecryptError,
  withSelfUpdateRetry,
  YtDlpError,
  type CookieAuthOptions
} from './ytdlp'
import { getApiKey, getImportPreferences, getModelPreferences } from '../settings'
import { projectDir, saveProject } from '../projects'

export async function createProject(videoPath: string): Promise<Project> {
  const video = await probeVideo(videoPath)
  const now = Date.now()
  const project: Project = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    name: video.fileName.replace(/\.[^.]+$/, ''),
    video,
    transcript: null,
    clips: [],
    prompt: '',
    videoType: 'auto'
  }
  await saveProject(project)
  return project
}

export async function createProjectFromUrl(
  url: string,
  onProgress: (p: ImportProgress) => void
): Promise<Project> {
  const binPath = await ensureYtDlp(onProgress)
  const prefs = getImportPreferences()
  const cookieOpts: CookieAuthOptions = {
    cookiesFromBrowser: prefs.importCookiesBrowser || undefined,
    cookiesFile: prefs.importCookiesPath
  }
  assertCookieAuthSupported(cookieOpts)
  onProgress({ progress: -1, message: 'Checking the video…' })
  const meta = await withSelfUpdateRetry(binPath, onProgress, () =>
    fetchUrlMeta(binPath, url, cookieOpts)
  ).catch(rethrowWithLoginHint(prefs.importCookiesBrowser, Boolean(prefs.importCookiesPath)))

  const id = randomUUID()
  const dir = projectDir(id)
  await mkdir(dir, { recursive: true })
  const videoPath = join(dir, 'source.mp4')
  onProgress({ progress: 0.15, message: 'Downloading video…' })
  await withSelfUpdateRetry(binPath, onProgress, () =>
    downloadUrlVideo(binPath, meta.webpageUrl, videoPath, onProgress, cookieOpts)
  ).catch(rethrowWithLoginHint(prefs.importCookiesBrowser, Boolean(prefs.importCookiesPath)))

  onProgress({ progress: 0.97, message: 'Reading video…' })
  const video = await probeVideo(videoPath)
  const now = Date.now()
  const project: Project = {
    id,
    createdAt: now,
    updatedAt: now,
    name: meta.title,
    video,
    transcript: null,
    clips: [],
    prompt: '',
    videoType: 'auto'
  }
  await saveProject(project)
  onProgress({ progress: 1, message: 'Done' })
  return project
}

/**
 * When a site rejects the request for auth reasons (private/unlisted video,
 * enterprise Vimeo behind SSO), point at the browser-login option instead of
 * surfacing a bare extractor error.
 */
function rethrowWithLoginHint(
  browser: BrowserCookieSource,
  hasCookiesFile: boolean
): (err: unknown) => never {
  return (err: unknown): never => {
    if (err instanceof YtDlpError) {
      if (isDpapiDecryptError(err.message)) {
        throw new YtDlpError(cookieDpapiErrorHint(hasCookiesFile))
      }
      if (isCookieCopyError(err.message)) {
        throw new YtDlpError(cookieCopyErrorHint(browser, hasCookiesFile))
      }
      if (isAuthError(err.message)) {
        const hint = browser || hasCookiesFile
          ? `This video still refused the login. Make sure you are signed in to the site in ${browser || 'your browser'} (open the video there once), then retry. Or import a fresh cookies.txt file.`
          : 'This video seems to need a login (private, unlisted or behind company SSO). Sign in to the site in your browser, then set "Use browser login" on the import screen or import a cookies.txt file.'
        throw new YtDlpError(`${err.message} ${hint}`)
      }
    }
    throw err
  }
}

type ProgressFn = (p: PipelineProgress) => void

/**
 * The full "get clips" pipeline: audio extraction -> Whisper transcription ->
 * LLM highlight detection -> per-clip thumbnails. Mutates and saves the
 * project.
 *
 * Resilience: the transcript is checkpointed to disk as soon as Whisper
 * finishes, and reused on later runs — so retries after a failure, and
 * "regenerate with a different prompt", never pay for transcription again.
 * The whole pipeline is cancellable via the AbortSignal.
 */
export async function analyzeProject(
  project: Project,
  options: AnalyzeOptions,
  onProgress: ProgressFn,
  signal?: AbortSignal
): Promise<Project> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('No OpenAI API key configured. Add one in Settings before generating clips.')
  }
  const settings = getModelPreferences()
  const workDir = join(tmpdir(), 'clipforge', `job-${project.id}`)
  await mkdir(workDir, { recursive: true })

  try {
    let transcript = project.transcript
    if (!transcript) {
      onProgress({ stage: 'audio', progress: 0.02, message: 'Extracting audio…' })
      const chunks = await extractAudioChunks(
        project.video.path,
        workDir,
        project.video.durationSec,
        (f) => onProgress({ stage: 'audio', progress: 0.02 + f * 0.13, message: 'Extracting audio…' }),
        signal
      )

      onProgress({ stage: 'transcribe', progress: 0.16, message: 'Transcribing with Whisper…' })
      transcript = await transcribeChunks(
        apiKey,
        settings.transcriptionModel,
        chunks,
        settings.transcriptionLanguage,
        (f) =>
          onProgress({
            stage: 'transcribe',
            progress: 0.16 + f * 0.4,
            message:
              chunks.length > 1
                ? `Transcribing (part ${Math.min(chunks.length, Math.ceil(f * chunks.length))}/${chunks.length})…`
                : 'Transcribing with Whisper…'
          }),
        signal
      )
      if (transcript.segments.length === 0) {
        throw new Error('No speech was detected in this video, so no clips could be generated.')
      }
      // Vocal-energy annotation feeds the virality analysis (arousal signal).
      onProgress({ stage: 'transcribe', progress: 0.56, message: 'Measuring vocal energy…' })
      await annotateEnergy(transcript, chunks)
      // Checkpoint: transcription is the most expensive stage, never redo it.
      project.transcript = transcript
      await saveProject(project)
    } else {
      onProgress({ stage: 'transcribe', progress: 0.56, message: 'Using saved transcript…' })
    }

    onProgress({ stage: 'analyze', progress: 0.58, message: 'Finding viral moments…' })
    const clips = await detectHighlights(
      apiKey,
      settings.analysisModel,
      transcript,
      options,
      project.video.durationSec,
      signal
    )
    if (clips.length === 0) {
      throw new Error('The AI could not find any clip-worthy moments in this video.')
    }

    // Visual rescoring (Kayal et al., ACL 2025): sample frames per clip, let
    // the LLM judge visual engagement, and ensemble with the text score.
    onProgress({ stage: 'analyze', progress: 0.64, message: 'Scoring visuals…' })
    let scored = 0
    await mapLimit(clips, 3, async (clip) => {
      signal?.throwIfAborted()
      const visual = await assessClipVisuals(
        apiKey,
        settings.analysisModel,
        project.video.path,
        transcript,
        clip,
        signal
      )
      if (visual) {
        clip.viralityScore = ensembleScore(clip.viralityScore, visual.visualScore)
        clip.visualSummary = visual.visualSummary
      }
      scored++
      onProgress({
        stage: 'analyze',
        progress: 0.64 + (scored / clips.length) * 0.08,
        message: 'Scoring visuals…'
      })
    })
    clips.sort((a, b) => b.viralityScore - a.viralityScore)

    project.clips = clips
    project.prompt = options.prompt
    project.videoType = options.videoType
    await saveProject(project)

    onProgress({ stage: 'reframe', progress: 0.72, message: 'Analysing layout (faces vs screen share)…' })
    let reframed = 0
    await mapLimit(clips, 2, async (clip) => {
      signal?.throwIfAborted()
      if (shouldAnalyzeFaces(options.videoType)) {
        const analysis = await analyzeClipFocus(
          project.video.path,
          clip.suggestedStart,
          clip.suggestedEnd,
          signal
        )
        applyFocusAnalysis(clip, analysis, options.videoType)
      } else {
        applyFocusAnalysis(
          clip,
          { focusTrack: null, contentType: 'screencast' },
          options.videoType
        )
      }
      reframed++
      onProgress({
        stage: 'reframe',
        progress: 0.72 + (reframed / clips.length) * 0.1,
        message: 'Analysing layout (faces vs screen share)…'
      })
    })

    if (options.broll) {
      onProgress({ stage: 'broll', progress: 0.82, message: 'Finding B-roll images…' })
      let brolled = 0
      await mapLimit(clips, 3, async (clip) => {
        signal?.throwIfAborted()
        try {
          await attachBroll(apiKey, settings.analysisModel, transcript, project.id, clip, signal)
        } catch (err) {
          if (signal?.aborted) throw err
          console.error(`B-roll failed for clip ${clip.id}:`, err)
          clip.broll = []
        }
        brolled++
        onProgress({
          stage: 'broll',
          progress: 0.82 + (brolled / clips.length) * 0.08,
          message: 'Finding B-roll images…'
        })
      })
      await saveProject(project)
    }

    onProgress({ stage: 'thumbnails', progress: 0.9, message: 'Creating thumbnails…' })
    const thumbsDir = join(projectDir(project.id), 'thumbs')
    await mkdir(thumbsDir, { recursive: true })
    for (let i = 0; i < clips.length; i++) {
      signal?.throwIfAborted()
      const clip = clips[i]
      const at = clip.suggestedStart + Math.min(1.5, (clip.suggestedEnd - clip.suggestedStart) / 2)
      try {
        clip.thumbnailPath = await extractThumbnail(project.video.path, at, join(thumbsDir, `${clip.id}.jpg`))
      } catch {
        clip.thumbnailPath = null
      }
      onProgress({
        stage: 'thumbnails',
        progress: 0.9 + ((i + 1) / clips.length) * 0.08,
        message: 'Creating thumbnails…'
      })
    }

    await saveProject(project)
    onProgress({ stage: 'done', progress: 1, message: 'Done' })
    return project
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
