import { join } from 'node:path'
import { app } from 'electron'
import * as ort from 'onnxruntime-node'
import { iou, type FaceBox } from './speaker'

/**
 * UltraFace RFB-320 face detection (ONNX, CPU) plus the shot-change detector,
 * shared by the legacy mouth-motion reframing path and the audio-visual
 * active-speaker path.
 */

export const MODEL_W = 320
export const MODEL_H = 240
const CONFIDENCE_THRESHOLD = 0.65
const IOU_THRESHOLD = 0.5

/** Directory containing bundled ONNX models (dev tree or packaged resources). */
export function modelsDir(): string {
  // `app` is undefined when this module runs outside Electron (test scripts).
  if (app?.isPackaged) {
    return join(process.resourcesPath, 'models')
  }
  const base = app?.getAppPath?.() ?? process.cwd()
  return join(base, 'resources', 'models')
}

let sessionPromise: Promise<ort.InferenceSession> | null = null

function getSession(): Promise<ort.InferenceSession> {
  sessionPromise ??= ort.InferenceSession.create(join(modelsDir(), 'ultraface-rfb-320.onnx'), {
    logSeverityLevel: 3
  })
  return sessionPromise
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
export async function detectFaces(rgb: Buffer): Promise<FaceBox[]> {
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

/** Frame-to-frame difference above this (0-255) counts as a camera cut. */
export const SCENE_CUT_THRESHOLD = 34

/** Mean absolute luma-ish difference between two raw RGB frames (sampled). */
export function frameDifference(a: Buffer, b: Buffer): number {
  let sum = 0
  let count = 0
  // Sample every 24th byte — plenty for shot-change detection at 320x240.
  for (let i = 0; i < a.length; i += 24) {
    sum += Math.abs(a[i] - b[i])
    count++
  }
  return sum / Math.max(1, count)
}
