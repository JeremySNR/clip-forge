import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { AnalyzeOptions, PipelineProgress, Project } from '@shared/types'
import { extractAudioChunks, extractThumbnail, probeVideo } from './ffmpeg'
import { transcribeChunks } from './transcribe'
import { detectHighlights } from './highlights'
import { getApiKey, getSettings } from '../settings'
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
    prompt: ''
  }
  await saveProject(project)
  return project
}

type ProgressFn = (p: PipelineProgress) => void

/**
 * The full "get clips" pipeline: audio extraction -> Whisper transcription ->
 * LLM highlight detection -> per-clip thumbnails. Mutates and saves the project.
 */
export async function analyzeProject(
  project: Project,
  options: AnalyzeOptions,
  onProgress: ProgressFn
): Promise<Project> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('No OpenAI API key configured. Add one in Settings before generating clips.')
  }
  const settings = getSettings()
  const workDir = join(tmpdir(), 'clipforge', `job-${project.id}`)
  await mkdir(workDir, { recursive: true })

  try {
    onProgress({ stage: 'audio', progress: 0.02, message: 'Extracting audio…' })
    const chunks = await extractAudioChunks(project.video.path, workDir, project.video.durationSec, (f) =>
      onProgress({ stage: 'audio', progress: 0.02 + f * 0.13, message: 'Extracting audio…' })
    )

    onProgress({ stage: 'transcribe', progress: 0.16, message: 'Transcribing with Whisper…' })
    const transcript = await transcribeChunks(apiKey, settings.transcriptionModel, chunks, (f) =>
      onProgress({
        stage: 'transcribe',
        progress: 0.16 + f * 0.4,
        message: chunks.length > 1 ? `Transcribing (part ${Math.min(chunks.length, Math.ceil(f * chunks.length))}/${chunks.length})…` : 'Transcribing with Whisper…'
      })
    )
    if (transcript.segments.length === 0) {
      throw new Error('No speech was detected in this video, so no clips could be generated.')
    }
    project.transcript = transcript

    onProgress({ stage: 'analyze', progress: 0.58, message: 'Finding viral moments…' })
    const clips = await detectHighlights(apiKey, settings.analysisModel, transcript, options, project.video.durationSec)
    if (clips.length === 0) {
      throw new Error('The AI could not find any clip-worthy moments in this video.')
    }
    project.clips = clips
    project.prompt = options.prompt

    onProgress({ stage: 'thumbnails', progress: 0.82, message: 'Creating thumbnails…' })
    const thumbsDir = join(projectDir(project.id), 'thumbs')
    await mkdir(thumbsDir, { recursive: true })
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      const at = clip.suggestedStart + Math.min(1.5, (clip.suggestedEnd - clip.suggestedStart) / 2)
      try {
        clip.thumbnailPath = await extractThumbnail(project.video.path, at, join(thumbsDir, `${clip.id}.jpg`))
      } catch {
        clip.thumbnailPath = null
      }
      onProgress({
        stage: 'thumbnails',
        progress: 0.82 + ((i + 1) / clips.length) * 0.16,
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
