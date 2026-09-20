import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Clip, Project, Transcript } from '@shared/types'
import { inferencePeakRssBytes, runInference } from './inference/client'
import { modelsDir, detectFaces } from './pipeline/detect'
import { detectFacesYuNet } from './pipeline/yunet'
import { encodeFaceTrack } from './pipeline/asdFrontend'
import { analyzeClipASD } from './pipeline/asd'
import { FFPROBE_PATH, FFMPEG_PATH, probeVideo, runFfmpeg } from './pipeline/ffmpeg'
import { renderClip } from './pipeline/render'
import { loadProject, saveProject } from './projects'
import { isAutoUpdateSupported, isSourceUpdateSupported } from './updates'

/** Opt-in offline check of the shipped resources/runtime, using an isolated profile. */
export async function validatePackage(dir: string): Promise<void> {
  assert.ok(app.isPackaged, 'Run this check against the packaged app')
  assert.ok(process.env.CUTAWAN_USER_DATA, 'An isolated test profile is required')
  await mkdir(dir, { recursive: true })
  const checks: string[] = []
  const passed = (name: string): void => { checks.push(name); console.log(`PASS ${name}`) }
  if (process.platform === 'darwin') {
    for (const binary of [FFMPEG_PATH, FFPROBE_PATH]) {
      assert.match(execFileSync('/usr/bin/file', ['-b', binary], { encoding: 'utf8' }),
        new RegExp(process.arch === 'arm64' ? 'arm64' : 'x86_64'))
    }
    assert.equal(isAutoUpdateSupported(), false)
    assert.equal(isSourceUpdateSupported(), false)
    passed('native Mac video binaries and manual update route')
  }

  await detectFaces(Buffer.alloc(320 * 240 * 3, 127))
  await detectFacesYuNet(Buffer.alloc(320 * 240 * 3, 127), 320, 240)
  passed('both face detectors through the packaged inference child')

  // Compare across multiple batch seams against the original full frontend call.
  const frames = 51
  const crops = Array.from({ length: frames }, (_, f) =>
    Uint8Array.from({ length: 112 * 112 }, (_, i) => (i * 17 + f * 31) % 256))
  const audio = Float32Array.from({ length: frames * 4 * 13 }, (_, i) => Math.sin(i * 0.1))
  const model = join(modelsDir(), 'lr-asd-frontend.onnx')
  const full = await runInference(model, {
    audio: { data: audio, dims: [1, frames * 4, 13] },
    video: { data: Float32Array.from(crops.flatMap(crop => [...crop])), dims: [1, frames, 112, 112] }
  })
  const batched = await encodeFaceTrack(model, crops, audio)
  let maxDifference = 0
  for (const name of ['embedA', 'embedV'] as const) {
    assert.equal(full[name].data.length, batched[name].length)
    for (let i = 0; i < batched[name].length; i++) {
      const difference = Math.abs(full[name].data[i] - batched[name][i])
      assert.ok(Number.isFinite(difference))
      maxDifference = Math.max(maxDifference, difference)
    }
  }
  assert.ok(maxDifference < 0.002, `Frontend batch parity: ${maxDifference}`)
  await runInference(join(modelsDir(), 'lr-asd-backend.onnx'), {
    embedA: { data: batched.embedA, dims: [1, frames, 128] },
    embedV: { data: batched.embedV, dims: [1, frames, 128] }
  })
  passed(`speaker model batch parity (maximum error ${maxDifference})`)

  const sourcePath = join(dir, 'source.mp4')
  await runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath])
  const source = await probeVideo(sourcePath)
  const words = [{ text: 'Package', start: 0.2, end: 1 }, { text: 'check.', start: 1, end: 2 }]
  const transcript: Transcript = { language: 'english', durationSec: 3,
    segments: [{ id: 0, text: 'Package check.', start: 0.2, end: 2, words }] }
  const clip: Clip = {
    id: 'package-check', suggestedStart: 0, suggestedEnd: 3, title: 'Package check', hook: '',
    summary: '', viralityScore: 0, viralityReason: '', visualSummary: null, hashtags: [],
    thumbnailPath: null, focusTrack: null, broll: [],
    edit: { start: 0, end: 3, aspect: 'original', reframeMode: 'crop', framing: 'manual',
      tightenCuts: false, focusX: 0.5, captionsEnabled: true, captionStyleId: 'beast', showTitle: false }
  }
  const project: Project = { id: 'package-check', name: 'Package check', createdAt: Date.now(),
    updatedAt: Date.now(), video: source, transcript, clips: [clip], prompt: '', videoType: 'auto' }
  await saveProject(project)
  const reopened = await loadProject(project.id)
  assert.equal(reopened.clips[0].id, clip.id)
  const outputPath = join(dir, 'export.mp4')
  await renderClip({ source: reopened.video, clip: reopened.clips[0], transcript: reopened.transcript,
    outputPath, encoder: 'cpu' })
  const exported = await probeVideo(outputPath)
  assert.ok(exported.hasAudio && exported.durationSec > 2.8)
  await runFfmpeg(['-v', 'error', '-i', outputPath, '-f', 'null', '-'])
  passed('project save/reopen, captioned export and complete decode')

  if (process.env.CUTAWAN_CHECK_VIDEO) {
    const start = Number(process.env.CUTAWAN_CHECK_START ?? 0)
    const end = Number(process.env.CUTAWAN_CHECK_END ?? start + 12)
    const analysis = await analyzeClipASD(process.env.CUTAWAN_CHECK_VIDEO, start, end)
    assert.ok(analysis && analysis.tracks.length > 0, 'Real-video check must exercise speaker inference')
    await writeFile(join(dir, 'real-video-analysis.json'), JSON.stringify(analysis))
    passed(`real footage: ${analysis.frameCount} frames, ${analysis.tracks.length} face tracks`)
  }
  await writeFile(join(dir, 'result.json'), JSON.stringify({ version: app.getVersion(),
    arch: process.arch, checks, maxDifference, inferencePeakRssBytes: inferencePeakRssBytes() }, null, 2))
}
