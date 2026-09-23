import { classifyClipStyle, persistentPresenterInset, type ClipStyle, type StyleSample } from '@shared/shotStyle'
import type { ContentRegion } from '@shared/types'
import { detectFaces, MODEL_H, MODEL_W } from './detect'
import { probeVideo, streamRawFrames } from './ffmpeg'
import { mediaJobs } from './mediaJobs'
import type { FaceBox } from './speaker'
import { detectFacesYuNet, faceDetectionSize, yunetAvailable } from './yunet'

/**
 * Cheap local style triage for one clip range (see shared/shotStyle.ts).
 * Decodes SAMPLE_COUNT short frame pairs and runs one face detection per
 * pair: about 2–5 seconds per clip for a 1080p source in local runs, against
 * tens of seconds for dense active-speaker analysis or several cloud requests
 * for layout review.
 */

const SAMPLE_COUNT = 6
/**
 * Pair frames this far apart. Neighbouring decoded frames can be exact
 * duplicates (frame-rate conversion, variable-frame-rate captures), which
 * would make live camera footage look like a still screen.
 */
const PAIR_FPS = 5
/** Long edge of the point-sampled luma used for stillness and dividers. */
const LUMA_LONG_EDGE = 320

/** Nearest-neighbour luma: averaging would smooth away the camera noise we measure. */
export function pointSampledLuma(rgb: Buffer, width: number, height: number, longEdge = LUMA_LONG_EDGE):
  { data: Uint8Array; width: number; height: number } {
  const step = Math.max(1, Math.round(Math.max(width, height) / longEdge))
  const w = Math.floor(width / step), h = Math.floor(height / step)
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y * step) * width + x * step) * 3
      data[y * w + x] = (77 * rgb[i] + 150 * rgb[i + 1] + 29 * rgb[i + 2]) >> 8
    }
  }
  return { data, width: w, height: h }
}

function nearestRgb(rgb: Buffer, width: number, height: number, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / w))
      rgb.copy(out, (y * w + x) * 3, (sy * width + sx) * 3, (sy * width + sx) * 3 + 3)
    }
  }
  return out
}

/** Sample times spread across the range, away from its very edges. */
export function triageTimes(start: number, end: number, count = SAMPLE_COUNT): number[] {
  const span = Math.max(0, end - start - 1 / PAIR_FPS)
  return Array.from({ length: count }, (_, i) => start + span * (i + 0.5) / count)
}

async function samplePair(video: string, time: number, size: { width: number; height: number },
  yunet: boolean, signal?: AbortSignal): Promise<StyleSample | null> {
  const frames: Buffer[] = []
  await streamRawFrames(['-ss', time.toFixed(3), '-i', video, '-an',
    '-vf', `fps=${PAIR_FPS},scale=${size.width}:${size.height}`, '-frames:v', '2',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24'], size.width * size.height * 3,
  frame => { frames.push(Buffer.from(frame)) }, signal)
  if (frames.length < 2) return null
  const a = pointSampledLuma(frames[0], size.width, size.height)
  const b = pointSampledLuma(frames[1], size.width, size.height)
  let faces: FaceBox[]
  if (yunet) faces = await detectFacesYuNet(frames[0], size.width, size.height, signal)
  else faces = await detectFaces(nearestRgb(frames[0], size.width, size.height, MODEL_W, MODEL_H), undefined, signal)
  return { width: a.width, height: a.height, a: a.data, b: b.data, faces }
}

export interface ClipTriage extends ClipStyle { seconds: number }

export function triageClipStyle(video: string, start: number, end: number, signal?: AbortSignal): Promise<ClipTriage> {
  return mediaJobs.run(async () => {
    const started = performance.now()
    const info = await probeVideo(video)
    const size = faceDetectionSize(info.width || 640, info.height || 360)
    const yunet = yunetAvailable()
    const samples: StyleSample[] = []
    for (const time of triageTimes(start, end)) {
      signal?.throwIfAborted()
      const sample = await samplePair(video, time, size, yunet, signal)
      if (sample) samples.push(sample)
    }
    return { ...classifyClipStyle(samples), seconds: (performance.now() - started) / 1000 }
  }, signal)
}

/** Frame pairs sampled per shot when locating a webcam panel. */
const PANEL_SAMPLES = 4

/**
 * The fixed webcam panel over screen content in one shot, from pixels alone
 * (see persistentPresenterInset). Undefined when there is none or the shot
 * is too short to sample.
 */
export function detectPresenterPanel(video: string, start: number, end: number, signal?: AbortSignal):
  Promise<ContentRegion | undefined> {
  if (end - start < 1) return Promise.resolve(undefined)
  return mediaJobs.run(async () => {
    const info = await probeVideo(video)
    const size = faceDetectionSize(info.width || 640, info.height || 360)
    const yunet = yunetAvailable()
    const samples: StyleSample[] = []
    for (const time of triageTimes(start, end, PANEL_SAMPLES)) {
      signal?.throwIfAborted()
      const sample = await samplePair(video, time, size, yunet, signal)
      if (sample) samples.push(sample)
    }
    return persistentPresenterInset(samples)
  }, signal)
}
