import type { PipelineProgress, Project, Transcript } from '@shared/types'
import { extractAudioChunks } from './ffmpeg'
import { transcribeChunks } from './transcribe'
import { annotateEnergy } from './energy'
import { updateProject } from '../projects'

/**
 * Whisper transcription for a project, shared by the clip-finding pipeline
 * and "caption whole video".
 *
 * Transcription is the most expensive stage of either flow, so the result is
 * checkpointed to disk the moment it lands and reused by every later run:
 * retries after a failure, regenerating clips with a new prompt, and moving
 * between the two modes never pay for it twice.
 */

/** Share of the progress span each step of the stage accounts for. */
const AUDIO_SHARE = 0.25
const TRANSCRIBE_SHARE = 0.7

export interface EnsureTranscriptOptions {
  apiKey: string
  model: string
  language: string
  /** Slice of the overall 0..1 pipeline progress this stage reports within. */
  span: { from: number; to: number }
  /** Error raised when the video turns out to have no speech at all. */
  noSpeechError: string
}

export async function ensureTranscript(
  project: Project,
  workDir: string,
  options: EnsureTranscriptOptions,
  onProgress: (p: PipelineProgress) => void,
  signal?: AbortSignal
): Promise<Transcript> {
  const { from, to } = options.span
  const at = (fraction: number): number => from + (to - from) * fraction

  if (project.transcript) {
    onProgress({ stage: 'transcribe', progress: at(1), message: 'Using saved transcript…' })
    return project.transcript
  }

  onProgress({ stage: 'audio', progress: at(0), message: 'Extracting audio…' })
  const chunks = await extractAudioChunks(
    project.video.path,
    workDir,
    project.video.durationSec,
    (f) =>
      onProgress({ stage: 'audio', progress: at(f * AUDIO_SHARE), message: 'Extracting audio…' }),
    signal
  )

  onProgress({
    stage: 'transcribe',
    progress: at(AUDIO_SHARE),
    message: 'Transcribing with Whisper…'
  })
  const transcript = await transcribeChunks(
    options.apiKey,
    options.model,
    chunks,
    options.language,
    (f) =>
      onProgress({
        stage: 'transcribe',
        progress: at(AUDIO_SHARE + f * TRANSCRIBE_SHARE),
        message:
          chunks.length > 1
            ? `Transcribing (part ${Math.min(chunks.length, Math.ceil(f * chunks.length))}/${chunks.length})…`
            : 'Transcribing with Whisper…'
      }),
    signal
  )
  if (transcript.segments.length === 0) throw new Error(options.noSpeechError)

  // Vocal energy feeds the virality analysis (arousal signal) and the auto
  // zoom's emphasis punch-ins, so both flows want it annotated.
  onProgress({
    stage: 'transcribe',
    progress: at(AUDIO_SHARE + TRANSCRIBE_SHARE),
    message: 'Measuring vocal energy…'
  })
  await annotateEnergy(transcript, chunks)

  // Checkpoint. Persist only the field this stage owns — saving the whole
  // local object would revert e.g. a rename that landed since it was loaded.
  project.transcript = transcript
  await updateProject(project.id, (p) => {
    p.transcript = transcript
  })
  return transcript
}
