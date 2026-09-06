import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Clip, Project } from '@shared/types'

/**
 * Integration test for on-demand reframe analysis: a project with a pending
 * clip on disk, a real (synthetic) video, the real UltraFace + LR-ASD path.
 * The synthetic footage has no faces, so the analysis must land as a
 * screencast verdict — what matters here is the plumbing: the analysis runs
 * once, persists, merges onto concurrent edits and is a no-op afterwards.
 */

// Hoisted above the imports (vi.mock needs the path), so it cannot use them.
const { userData } = await vi.hoisted(async () => {
  const os = await import('node:os')
  const path = await import('node:path')
  return { userData: path.join(os.tmpdir(), `clipforge-lazy-reframe-${process.pid}-${Date.now()}`) }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    getAppPath: () => process.cwd(),
    isPackaged: false
  }
}))

const { ensureClipReframe } = await import('../src/main/pipeline/reframe')
const { loadProject, projectDir } = await import('../src/main/projects')
const { runFfmpeg, probeVideo } = await import('../src/main/pipeline/ffmpeg')

const PROJECT_ID = 'lazy-reframe-test'

function pendingClip(id: string, end: number): Clip {
  return {
    id,
    suggestedStart: 0,
    suggestedEnd: end,
    title: 'Untouched title',
    hook: '',
    summary: '',
    viralityScore: 50,
    viralityReason: '',
    visualSummary: null,
    hashtags: [],
    thumbnailPath: null,
    focusTrack: null,
    reframeStatus: 'pending',
    contentType: null,
    broll: [],
    edit: {
      aspect: '9:16',
      reframeMode: 'crop',
      framing: 'manual',
      tightenCuts: true,
      autoZoom: true,
      focusX: 0.5,
      captionsEnabled: true,
      captionStyleId: 'beast',
      showTitle: false,
      start: 0,
      end
    }
  }
}

async function writeProject(project: Project): Promise<void> {
  await writeFile(join(projectDir(project.id), 'project.json'), JSON.stringify(project), 'utf8')
}

describe('ensureClipReframe', () => {
  let project: Project

  beforeAll(async () => {
    const dir = projectDir(PROJECT_ID)
    await mkdir(dir, { recursive: true })
    const videoPath = join(dir, 'source.mp4')
    // Three seconds of moving test pattern with a tone: decodes fast, has no faces.
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', videoPath
    ])
    const video = await probeVideo(videoPath)
    project = {
      id: PROJECT_ID,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      name: 'Lazy reframe',
      video,
      transcript: null,
      clips: [pendingClip('faces', video.durationSec), pendingClip('demo', video.durationSec)],
      prompt: '',
      videoType: 'podcast'
    }
    await writeProject(project)
  }, 60_000)

  afterAll(async () => {
    await rm(userData, { recursive: true, force: true })
  })

  it('analyses a pending clip once, persists it and shares the run between callers', async () => {
    const [a, b] = await Promise.all([
      ensureClipReframe(PROJECT_ID, 'faces'),
      ensureClipReframe(PROJECT_ID, 'faces')
    ])
    expect(a).toBe(b)
    const done = a.clips.find((c) => c.id === 'faces')!
    expect(done.reframeStatus).toBe('done')
    // No faces in a test pattern: classified as a screencast and letterboxed.
    expect(done.contentType).toBe('screencast')
    expect(done.focusTrack).toBeNull()
    expect(done.edit.reframeMode).toBe('fit-letterbox')
    expect(done.edit.autoZoom).toBe(false)

    const onDisk = JSON.parse(
      await readFile(join(projectDir(PROJECT_ID), 'project.json'), 'utf8')
    ) as Project
    expect(onDisk.clips.find((c) => c.id === 'faces')?.reframeStatus).toBe('done')
    // The other clip is untouched.
    expect(onDisk.clips.find((c) => c.id === 'demo')?.reframeStatus).toBe('pending')
  }, 60_000)

  it('is a no-op once analysed', async () => {
    const before = await loadProject(PROJECT_ID)
    const after = await ensureClipReframe(PROJECT_ID, 'faces')
    expect(after.clips.find((c) => c.id === 'faces')).toEqual(before.clips.find((c) => c.id === 'faces'))
  })

  it('keeps edits saved while the analysis was running', async () => {
    // Start the analysis, then change the title on disk before it lands.
    const running = ensureClipReframe(PROJECT_ID, 'demo')
    const { updateProject } = await import('../src/main/projects')
    await updateProject(PROJECT_ID, (fresh) => {
      const clip = fresh.clips.find((c) => c.id === 'demo')!
      clip.title = 'Renamed mid-analysis'
      clip.edit.captionStyleId = 'neon'
    })
    const result = await running
    const clip = result.clips.find((c) => c.id === 'demo')!
    expect(clip.reframeStatus).toBe('done')
    expect(clip.title).toBe('Renamed mid-analysis')
    expect(clip.edit.captionStyleId).toBe('neon')
  }, 60_000)

  it('returns the project unchanged for an unknown clip', async () => {
    const result = await ensureClipReframe(PROJECT_ID, 'nope')
    expect(result.clips.map((c) => c.id)).toEqual(['faces', 'demo'])
  })
})
