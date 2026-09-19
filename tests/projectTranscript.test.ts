import { describe, expect, it, vi } from 'vitest'
import type { Project } from '@shared/types'
import { ensureTranscript } from '../src/main/pipeline/projectTranscript'

describe('no-audio input', () => {
  it('reports an actionable outcome before invoking FFmpeg or a speech service', async () => {
    const progress = vi.fn()
    const project = { transcript: null, video: { hasAudio: false, path: 'does-not-exist.webm' } } as Project
    await expect(ensureTranscript(project, 'does-not-exist', {
      apiKey: 'unused', model: 'unused', language: 'en', span: { from: 0, to: 1 }, noSpeechError: 'No speech'
    }, progress)).rejects.toThrow('This video has no audio track')
    expect(progress).not.toHaveBeenCalled()
  })
})
