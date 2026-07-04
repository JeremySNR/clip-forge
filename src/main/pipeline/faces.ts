import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import * as ort from 'onnxruntime-node'
import type { FocusKeyframe } from '@shared/types'
import { runFfmpeg } from './ffmpeg'

/**
 * Face-based auto reframing. Samples clip frames with ffmpeg, detects faces
 * with UltraFace RFB-320 (ONNX, CPU) and builds a piecewise-constant focus
 * track: stable segments with hard cuts between speaker positions, the way
 * social clipping tools reframe multi-speaker footage.
 */

const MODEL_W = 320
const MODEL_H = 240
const SAMPLE_FPS = 2
const CONFIDENCE_THRESHOLD = 0.65
const IOU_THRESHOLD = 0.5
/** Minimum focus shift (normalized) that justifies a cut to a new segment. */
const SEGMENT_SHIFT_THRESHOLD = 0.1
/** Frames a shift must persist before we cut (at SAMPLE_FPS). */
const SEGMENT_MIN_FRAMES = 3

interface FaceBox {
  x1: number
  y1: number
  x2: number
  y2: number
  score: number
}

let sessionPromise: Promise<ort.InferenceSession> | null = null

function modelPath(): string {
  // `app` is undefined when this module runs outside Electron (test scripts).
  if (app?.isPackaged) {
    return join(process.resourcesPath, 'models', 'ultraface-rfb-320.onnx')
  }
  const base = app?.getAppPath?.() ?? process.cwd()
  return join(base, 'resources', 'models', 'ultraface-rfb-320.onnx')
}

function getSession(): Promise<ort.InferenceSession> {
  sessionPromise ??= ort.InferenceSession.create(modelPath(), { logSeverityLevel: 3 })
  return sessionPromise
}

function iou(a: FaceBox, b: FaceBox): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  const inter = ix * iy
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / Math.max(1e-9, areaA + areaB - inter)
}

function nms(boxes: FaceBox[]): FaceBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score)
  const kept: FaceBox[] = []
  for (const box of sorted) {
    if (kept.every((k) => iou(k, box) < IOU_THRESHOLD)) kept.push(box)
  }
  return kept
}

/** Run UltraFace on one raw RGB frame (MODEL_W x MODEL_H). */
async function detectFaces(rgb: Buffer): Promise<FaceBox[]> {
  const session = await getSession()
  const size = MODEL_W * MODEL_H
  const input = new Float32Array(3 * size)
  // HWC uint8 RGB -> CHW float32, (v - 127) / 128
  for (let i = 0; i < size; i++) {
    input[i] = (rgb[i * 3] - 127) / 128
    input[size + i] = (rgb[i * 3 + 1] - 127) / 128
    input[2 * size + i] = (rgb[i * 3 + 2] - 127) / 128
  }
  const output = await session.run({
    input: new ort.Tensor('float32', input, [1, 3, MODEL_H, MODEL_W])
  })
  const scores = output.scores.data as Float32Array
  const boxes = output.boxes.data as Float32Array
  const candidates: FaceBox[] = []
  const count = output.scores.dims[1]
  for (let i = 0; i < count; i++) {
    const score = scores[i * 2 + 1]
    if (score < CONFIDENCE_THRESHOLD) continue
    candidates.push({
      x1: boxes[i * 4],
      y1: boxes[i * 4 + 1],
      x2: boxes[i * 4 + 2],
      y2: boxes[i * 4 + 3],
      score
    })
  }
  return nms(candidates)
}

/** Extract per-frame primary-face centres for a clip range of the source video. */
async function sampleFaceCentres(
  videoPath: string,
  startSec: number,
  endSec: number
): Promise<Array<number | null>> {
  const duration = Math.max(0.1, endSec - startSec)
  const rawPath = join(tmpdir(), 'clipforge', `faces-${randomUUID()}.rgb`)
  await runFfmpeg([
    '-ss', startSec.toFixed(3),
    '-t', duration.toFixed(3),
    '-i', videoPath,
    '-vf', `fps=${SAMPLE_FPS},scale=${MODEL_W}:${MODEL_H}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    rawPath
  ])
  try {
    const raw = await readFile(rawPath)
    const frameBytes = MODEL_W * MODEL_H * 3
    const frameCount = Math.floor(raw.length / frameBytes)
    const centres: Array<number | null> = []
    for (let f = 0; f < frameCount; f++) {
      const frame = raw.subarray(f * frameBytes, (f + 1) * frameBytes)
      const faces = await detectFaces(frame)
      if (faces.length === 0) {
        centres.push(null)
        continue
      }
      // Primary face: biggest weighted by confidence (the speaker on screen).
      const primary = faces.reduce((best, cur) => {
        const area = (b: FaceBox): number => (b.x2 - b.x1) * (b.y2 - b.y1)
        return area(cur) * cur.score > area(best) * best.score ? cur : best
      })
      centres.push((primary.x1 + primary.x2) / 2)
    }
    return centres
  } finally {
    await rm(rawPath, { force: true }).catch(() => undefined)
  }
}

function medianSmooth(values: number[], window: number): number[] {
  const half = Math.floor(window / 2)
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), i + half + 1)
    const sorted = [...slice].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  })
}

/**
 * Turn per-frame centres into a piecewise-constant focus track. Returns null
 * when too few faces were found to be useful (caller falls back to manual).
 */
export function buildFocusTrack(
  centres: Array<number | null>,
  clipStartSec: number
): FocusKeyframe[] | null {
  const detected = centres.filter((c): c is number => c !== null)
  if (detected.length < centres.length * 0.3 || detected.length < 2) return null

  // Fill gaps with the previous known centre (then backfill leading nulls).
  const filled: number[] = []
  let last = detected[0]
  for (const c of centres) {
    if (c !== null) last = c
    filled.push(last)
  }
  const smooth = medianSmooth(filled, 5)

  const keyframes: FocusKeyframe[] = []
  let segmentStart = 0
  let segmentValues = [smooth[0]]
  let shiftRun = 0

  const emit = (fromFrame: number): void => {
    const mean = segmentValues.reduce((a, b) => a + b, 0) / segmentValues.length
    keyframes.push({
      t: clipStartSec + fromFrame / SAMPLE_FPS,
      x: Math.min(1, Math.max(0, mean))
    })
  }

  for (let i = 1; i < smooth.length; i++) {
    const segMean = segmentValues.reduce((a, b) => a + b, 0) / segmentValues.length
    if (Math.abs(smooth[i] - segMean) > SEGMENT_SHIFT_THRESHOLD) {
      shiftRun++
      if (shiftRun >= SEGMENT_MIN_FRAMES) {
        emit(segmentStart)
        segmentStart = i - shiftRun + 1
        segmentValues = smooth.slice(segmentStart, i + 1)
        shiftRun = 0
      }
    } else {
      shiftRun = 0
      segmentValues.push(smooth[i])
    }
  }
  emit(segmentStart)
  return keyframes
}

/**
 * Full auto-reframe analysis for one clip. Returns null when the footage has
 * no usable faces (e.g. screencasts) so the UI can fall back to manual focus.
 */
export async function analyzeClipFocus(
  videoPath: string,
  startSec: number,
  endSec: number
): Promise<FocusKeyframe[] | null> {
  try {
    const centres = await sampleFaceCentres(videoPath, startSec, endSec)
    return buildFocusTrack(centres, startSec)
  } catch (err) {
    console.error('Face analysis failed, falling back to manual focus:', err)
    return null
  }
}
