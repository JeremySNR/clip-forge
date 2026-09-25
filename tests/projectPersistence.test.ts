import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Project } from '@shared/types'

const mock = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => mock.root } }))
import { loadProject, projectDir, saveProject, updateProject } from '../src/main/projects'
import { ensureTranscript } from '../src/main/pipeline/projectTranscript'

beforeAll(async () => { mock.root = await mkdtemp(join(tmpdir(), 'cutawan-project-persistence-')) })
afterAll(async () => { if (mock.root) await rm(mock.root, { recursive: true, force: true }) })

it('lets background readers see complete project JSON while edits are saved', async () => {
  const project: Project = {
    id: 'atomic-read-test', createdAt: 0, updatedAt: 0, name: 'Atomic read test',
    video: { path: join(mock.root, 'missing.mp4'), fileName: 'missing.mp4', durationSec: 5,
      width: 640, height: 360, fps: 25, sizeBytes: 0, hasAudio: true },
    transcript: null, clips: [], prompt: 'initial', videoType: 'auto'
  }
  await saveProject(project)
  const writer = async (): Promise<void> => {
    for (let i = 0; i < 40; i++) {
      await updateProject(project.id, fresh => { fresh.prompt = `${i}:${'x'.repeat(100_000)}` })
    }
  }
  const reader = async (): Promise<void> => {
    for (let i = 0; i < 120; i++) {
      const read = await loadProject(project.id)
      expect(read.prompt === 'initial' || /^\d+:x{100000}$/.test(read.prompt)).toBe(true)
    }
  }
  await Promise.all([writer(), reader(), reader()])
  expect((await loadProject(project.id)).prompt).toMatch(/^39:/)
  expect((await readdir(projectDir(project.id))).filter(name => name.endsWith('.tmp'))).toEqual([])
})

it('checkpoints an explicit empty transcript for visual discovery without invoking speech extraction', async () => {
  const project: Project = {
    id: 'silent-visual-input', createdAt: 0, updatedAt: 0, name: 'Silent input',
    video: { path: join(mock.root, 'silent.mp4'), fileName: 'silent.mp4', durationSec: 20,
      width: 640, height: 360, fps: 25, sizeBytes: 0, hasAudio: false },
    transcript: null, clips: [], prompt: '', videoType: 'auto'
  }
  await saveProject(project)
  const transcript = await ensureTranscript(project, mock.root, {
    apiKey: '', model: '', language: 'auto', span: { from: 0, to: .5 }, noSpeechError: 'No speech', allowNoSpeech: true
  }, () => {})
  expect(transcript).toMatchObject({ durationSec: 20, segments: [], speech: [] })
  expect((await loadProject(project.id)).transcript).toEqual(transcript)
})
