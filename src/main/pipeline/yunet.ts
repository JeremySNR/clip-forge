import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as ort from 'onnxruntime-node'
import { modelsDir } from './detect'
import { iou, type FaceBox } from './speaker'

/** OpenCV Zoo YuNet, dynamic-shape export; see resources/models/yunet-LICENSE. */
const MODEL_NAME = 'face-detection-yunet.onnx'
let sessionPromise: Promise<ort.InferenceSession> | null = null

export function yunetAvailable(): boolean {
  return existsSync(join(modelsDir(), MODEL_NAME))
}

/** Preserve aspect ratio and retain small faces; never upscale the source. */
export function faceDetectionSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 1280 / Math.max(1, width, height))
  return { width: Math.max(2, Math.round(width * scale / 2) * 2),
    height: Math.max(2, Math.round(height * scale / 2) * 2) }
}

/** Raw RGB to zero-padded, unnormalized BGR tensor required by YuNet. */
export function yunetInput(rgb: Buffer, width: number, height: number): { data: Float32Array; width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgb.length !== width * height * 3) {
    throw new Error('Invalid YuNet input frame')
  }
  const paddedW = Math.ceil(width / 32) * 32
  const paddedH = Math.ceil(height / 32) * 32
  const plane = paddedW * paddedH
  const data = new Float32Array(plane * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 3, target = y * paddedW + x
      data[target] = rgb[source + 2]
      data[plane + target] = rgb[source + 1]
      data[2 * plane + target] = rgb[source]
    }
  }
  return { data, width: paddedW, height: paddedH }
}

/** Decode the documented stride-8/16/32 heads into source-normalized boxes. */
export function decodeYuNet(
  heads: Record<string, ArrayLike<number>>, paddedWidth: number, width: number, height: number,
  confidence = 0.75
): FaceBox[] {
  const clamp = (v: number): number => Math.max(0, Math.min(1, v))
  const candidates: FaceBox[] = []
  for (const stride of [8, 16, 32]) {
    const cls = heads[`cls_${stride}`], obj = heads[`obj_${stride}`], boxes = heads[`bbox_${stride}`]
    if (!cls || !obj || !boxes || cls.length !== obj.length || boxes.length !== cls.length * 4) {
      throw new Error('Unexpected YuNet output shape')
    }
    const columns = paddedWidth / stride
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(clamp(cls[i]) * clamp(obj[i]))
      if (!Number.isFinite(score) || score < confidence) continue
      const cx = ((i % columns) + boxes[4 * i]) * stride
      const cy = (Math.floor(i / columns) + boxes[4 * i + 1]) * stride
      const w = Math.exp(boxes[4 * i + 2]) * stride, h = Math.exp(boxes[4 * i + 3]) * stride
      if (![cx, cy, w, h].every(Number.isFinite) || cx < 0 || cx >= width || cy < 0 || cy >= height) continue
      const box = { x1: clamp((cx - w / 2) / width), y1: clamp((cy - h / 2) / height),
        x2: clamp((cx + w / 2) / width), y2: clamp((cy + h / 2) / height), score }
      if (box.x2 > box.x1 && box.y2 > box.y1) candidates.push(box)
    }
  }
  const kept: FaceBox[] = []
  for (const box of candidates.sort((a, b) => b.score - a.score).slice(0, 5000)) {
    if (kept.every(other => iou(box, other) < 0.3)) kept.push(box)
  }
  return kept
}

export async function detectFacesYuNet(rgb: Buffer, width: number, height: number): Promise<FaceBox[]> {
  sessionPromise ??= ort.InferenceSession.create(join(modelsDir(), MODEL_NAME), { logSeverityLevel: 3 })
  const session = await sessionPromise
  const input = yunetInput(rgb, width, height)
  const outputs = await session.run({ [session.inputNames[0]]:
    new ort.Tensor('float32', input.data, [1, 3, input.height, input.width]) })
  return decodeYuNet(Object.fromEntries(Object.entries(outputs).map(([key, value]) =>
    [key, value.data as Float32Array])), input.width, width, height)
}
