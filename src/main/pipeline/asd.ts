import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { runInference } from '../inference/client'
import { encodeFaceTrack, type FaceCrops } from './asdFrontend'
import { FaceCropStore } from './faceCropStore'
import { runFfmpeg, streamRawFrames, probeVideo } from './ffmpeg'
import { computeMfcc, MFCC_COEFFS } from './mfcc'
import { buildFaceTracks, type FaceTrack } from './facetracks'
import { detectFaces, frameDifference, modelsDir, MODEL_W, MODEL_H } from './detect'
import type { FaceBox } from './speaker'
import { detectFacesYuNet, faceDetectionSize, yunetAvailable } from './yunet'
import { timed } from './timing'

/**
 * Audio-visual active speaker detection with LR-ASD (Liao et al., IJCV 2025).
 *
 * The model watches each face's mouth region *and listens to the audio at the
 * same time*, scoring every face on every frame as speaking or silent. Unlike
 * the older mouth-motion heuristic it can use audio correlation to reduce
 * false switches caused by gestures or unrelated mouth movement. It can
 * still make mistakes, particularly with overlap or poor face crops. For
 * videos without an audio track the model's visual-only head is used instead.
 *
 * Per clip: sample frames at 25 fps, detect faces (YuNet, UltraFace fallback), build
 * per-person tracks, crop each track's mouth-centred square to 112x112
 * grayscale, extract 13-dim MFCC audio features (4 per video frame), then run
 * the two-stage ONNX model. Scores are raw class-1 logits: > 0 means
 * speaking, matching the reference implementation.
 */

export const ASD_FPS = 25
/**
 * Detect faces on every Nth analysis frame (5 fps); boxes in between
 * interpolate and are median-smoothed over 0.5 s anyway. On the Wozniak
 * interview this cut reframing time ~30% versus every 2nd frame with the
 * focus path unchanged (scripts/bench-reframe.ts). Scene cuts still detect
 * immediately.
 */
const DETECT_STRIDE = 5
const CROP_SIZE = 112
/**
 * ASD input crop, replicating the reference preprocessing: a square of
 * 0.7 x max(boxW, boxH) centred on the face and shifted down by
 * 0.2 x max(boxW, boxH) — tight on the mouth, which is what the visual
 * encoder was trained on.
 */
const CROP_SIDE_FACTOR = 0.7
const CROP_DOWN_SHIFT = 0.2
/** Fill value for crop pixels outside the frame (matches reference padding). */
const CROP_PAD = 110
/**
 * The recurrent backend is evaluated over several window lengths and the
 * scores averaged — the reference implementation's multi-duration ensemble.
 * The backend is tiny, so this costs almost nothing on top of the frontend.
 */
const BACKEND_WINDOWS_SEC = [1, 2, 3, 4, 5, 6]
/** Preserve source mouth detail up to this long edge, without upscaling. */
const CROP_PASS_LONG_EDGE = 1920
/**
 * Consecutive-frame difference that counts as a camera cut. Lower than the
 * legacy 2 fps threshold (34): at 25 fps normal motion barely registers
 * between neighbouring frames, while even soft cuts and dissolves spike.
 */
const ASD_SCENE_CUT_THRESHOLD = 24
/** Cuts closer together than this are one transition (dissolves span frames). */
const CUT_MERGE_SEC = 0.3
/**
 * Switch to sparse scouting during long face-free passages, but always scan
 * the entire clip: an intro or screen share can be followed by a speaker.
 */
const FACE_PROBE_SEC = 8
const FACE_ABSENT_SPARSE_SEC = 3
const SCOUT_STRIDE = 12 // at most 0.48 seconds to reacquire a returning face
/**
 * Half-resolution detection is ~5x cheaper. It is used only between
 * full-resolution checks (each shot start and every 2 s) while every face
 * found is large; a frame where it finds fewer faces is redone at full size.
 * It also runs when full size finds nothing, catching extreme close-ups.
 * Measured on five podcast/talking-head sources: ~17% less reframing time,
 * focus unchanged except where close-ups were newly found.
 */
const FULL_DETECT_EVERY = 50
const LARGE_FACE_HEIGHT = 0.1
/**
 * Tracks must cover at least this fraction of analysis frames before we run
 * the heavy crop + LR-ASD passes (buildFocusTrack needs ~30%).
 */
const MIN_TRACK_COVERAGE = 0.25

export function asdAvailable(): Promise<boolean> {
  return Promise.resolve(['lr-asd-frontend.onnx', 'lr-asd-backend.onnx']
    .every(name => existsSync(join(modelsDir(), name))))
}

export interface ScoredFaceTrack {
  /** First analysis-frame index (at ASD_FPS) covered by the track. */
  start: number
  /** Horizontal face centre (0..1) per frame from `start`. */
  centres: number[]
  /** Face box area (normalised) per frame from `start`. */
  areas: number[]
  /** Active-speaker logit per frame from `start` (> 0 means speaking). */
  scores: number[]
  /** Smoothed face box per frame from `start`, for layouts that need more than x. */
  boxes?: FaceBox[]
}

export interface AsdAnalysis {
  tracks: ScoredFaceTrack[]
  frameCount: number
  sceneCuts: number[]
  sceneTransitions?: Array<{ start: number; end: number }>
  fps: number
  /** Estimated share of source time with a face, weighted for variable sampling. */
  faceFrameRatio: number
  /** Actual decoded dimensions used for the mouth crops, for framing safety. */
  cropSize?: { width: number; height: number }
  detector?: 'yunet' | 'ultraface'
}

interface DetectionPass {
  facesPerFrame: Array<FaceBox[] | null>
  sceneCuts: number[]
  sceneTransitions: Array<{ start: number; end: number }>
  frameCount: number
  faceFrameRatio: number
}

/** Keep dissolve frames separate from stable shots used for layout decisions. */
export function sceneTransitionRanges(differences: number[], fps = ASD_FPS): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const shoulder = ASD_SCENE_CUT_THRESHOLD / 4
  const reach = Math.ceil(fps * 0.6)
  for (let i = 1; i < differences.length; i++) {
    if (differences[i] <= ASD_SCENE_CUT_THRESHOLD) continue
    let start = i, end = i + 1
    while (start > Math.max(1, i - reach) && differences[start - 1] > shoulder) start--
    while (end < Math.min(differences.length, i + reach + 1) && differences[end] > shoulder) end++
    const previous = ranges.at(-1)
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
    else ranges.push({ start, end })
  }
  return ranges
}

/** Scene cuts trigger immediate detection; returning faces restore dense sampling. */
export function shouldDetectFaces(
  frameIndex: number,
  lastFaceFrame: number,
  sceneCut = false,
  stride = DETECT_STRIDE
): boolean {
  const sparse = lastFaceFrame < 0
    ? frameIndex >= FACE_PROBE_SEC * ASD_FPS
    : frameIndex - lastFaceFrame >= FACE_ABSENT_SPARSE_SEC * ASD_FPS
  return sceneCut || frameIndex % (sparse ? SCOUT_STRIDE : stride) === 0
}

/** Fraction of analysis frames covered by face tracks (unit-tested). */
export function trackCoverageRatio(tracks: FaceTrack[], frameCount: number): number {
  let covered = 0
  let end = 0
  for (const t of [...tracks].sort((a, b) => a.start - b.start)) {
    const stop = Math.min(frameCount, t.start + t.boxes.length)
    covered += Math.max(0, stop - Math.max(end, t.start))
    end = Math.max(end, stop)
  }
  return covered / Math.max(1, frameCount)
}

/** Pass 1: stream RGB frames; detect scene cuts and faces (strided). */
export async function runDetectionPass(
  videoPath: string,
  startSec: number,
  duration: number,
  signal?: AbortSignal,
  highResolution?: { width: number; height: number },
  stride = DETECT_STRIDE,
  adaptive = true
): Promise<DetectionPass> {
  const facesPerFrame: Array<FaceBox[] | null> = []
  let lastFull = -Infinity, fullCount = 0, allLarge = false
  const detectHigh = async (frame: Buffer, f: number, cut: boolean): Promise<FaceBox[]> => {
    const halfOk = adaptive && !cut && allLarge && f - lastFull < FULL_DETECT_EVERY
    if (halfOk) {
      const half = halveRgb(frame, width, height)
      const faces = await detectFacesYuNet(half.data, half.width, half.height, signal)
      if (faces.length >= fullCount) return faces
    }
    let faces = await detectFacesYuNet(frame, width, height, signal)
    // A face filling the frame (an extreme close-up) exceeds YuNet's largest
    // scale at full size but fits at half size.
    if (!faces.length && adaptive) {
      const half = halveRgb(frame, width, height)
      faces = await detectFacesYuNet(half.data, half.width, half.height, signal)
    }
    lastFull = f
    fullCount = faces.length
    allLarge = faces.length > 0 && faces.every(face => face.y2 - face.y1 >= LARGE_FACE_HEIGHT)
    return faces
  }
  const rawCuts: number[] = []
  const differences: number[] = []
  let prev: Buffer | null = null
  let framesWithFaces = 0
  let lastFaceFrame = -1
  let facePresent = false
  const width = highResolution?.width ?? MODEL_W
  const height = highResolution?.height ?? MODEL_H

  signal?.throwIfAborted()
  await streamRawFrames(
    [
      '-ss', startSec.toFixed(3),
      '-t', duration.toFixed(3),
      '-i', videoPath,
      '-vf', `fps=${ASD_FPS},scale=${width}:${height}`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24'
    ],
    width * height * 3,
    async (frame, f) => {
      signal?.throwIfAborted()
      const difference = prev ? frameDifference(prev, frame) : 0
      differences.push(difference)
      const cut = difference > ASD_SCENE_CUT_THRESHOLD
      if (cut) rawCuts.push(f)
      if (shouldDetectFaces(f, lastFaceFrame, cut, stride)) {
        const faces = highResolution ? await detectHigh(frame, f, cut) : await detectFaces(frame, undefined, signal)
        facesPerFrame.push(faces)
        facePresent = faces.length > 0
        if (facePresent) {
          lastFaceFrame = f
        }
      } else {
        facesPerFrame.push(null)
      }
      // Weight by source time, not the denser sampling of talking-head shots.
      if (facePresent) framesWithFaces++
      prev = Buffer.from(frame)
    },
    signal
  )

  const frameCount = facesPerFrame.length
  const faceFrameRatio = frameCount > 0 ? framesWithFaces / frameCount : 0
  // A dissolve registers on several neighbouring frames; keep only the last
  // of each cluster (when the new shot has settled).
  const mergeWindow = Math.max(1, Math.round(CUT_MERGE_SEC * ASD_FPS))
  const sceneCuts = rawCuts.filter((cut, i) => i === rawCuts.length - 1 || rawCuts[i + 1] - cut > mergeWindow)
  return { facesPerFrame, sceneCuts, sceneTransitions: sceneTransitionRanges(differences), frameCount, faceFrameRatio }
}

/** 2x2 box downscale of packed RGB (odd trailing row/column dropped). */
export function halveRgb(rgb: Buffer, width: number, height: number): { data: Buffer; width: number; height: number } {
  const w = Math.floor(width / 2), h = Math.floor(height / 2)
  const out = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * width * 3, r1 = r0 + width * 3
    for (let x = 0; x < w; x++) {
      const a = r0 + 6 * x, b = r1 + 6 * x, o = (y * w + x) * 3
      for (let c = 0; c < 3; c++) out[o + c] = (rgb[a + c] + rgb[a + 3 + c] + rgb[b + c] + rgb[b + 3 + c] + 2) >> 2
    }
  }
  return { data: out, width: w, height: h }
}

/** Bilinear sample of a square region into a CROP_SIZE² grayscale patch. */
function cropFace(
  frame: Buffer,
  fw: number,
  fh: number,
  cx: number,
  cy: number,
  side: number
): Uint8Array {
  const out = new Uint8Array(CROP_SIZE * CROP_SIZE)
  const x0 = cx - side / 2
  const y0 = cy - side / 2
  const step = side / CROP_SIZE
  for (let oy = 0; oy < CROP_SIZE; oy++) {
    const sy = y0 + (oy + 0.5) * step - 0.5
    const iy = Math.floor(sy)
    const fy = sy - iy
    for (let ox = 0; ox < CROP_SIZE; ox++) {
      const sx = x0 + (ox + 0.5) * step - 0.5
      const ix = Math.floor(sx)
      const fx = sx - ix
      const px = (x: number, y: number): number =>
        x < 0 || y < 0 || x >= fw || y >= fh ? CROP_PAD : frame[y * fw + x]
      const v =
        px(ix, iy) * (1 - fx) * (1 - fy) +
        px(ix + 1, iy) * fx * (1 - fy) +
        px(ix, iy + 1) * (1 - fx) * fy +
        px(ix + 1, iy + 1) * fx * fy
      out[oy * CROP_SIZE + ox] = v
    }
  }
  return out
}

/** Pass 2: stream grayscale frames and collect per-track 112x112 face crops. */
async function runCropPass(
  videoPath: string,
  startSec: number,
  duration: number,
  tracks: FaceTrack[],
  cropW: number,
  cropH: number,
  crops: FaceCropStore,
  signal?: AbortSignal
): Promise<void> {
  await streamRawFrames(
    [
      '-ss', startSec.toFixed(3),
      '-t', duration.toFixed(3),
      '-i', videoPath,
      '-vf', `fps=${ASD_FPS},scale=${cropW}:${cropH}`,
      '-f', 'rawvideo',
      '-pix_fmt', 'gray'
    ],
    cropW * cropH,
    async (frame, f) => {
      signal?.throwIfAborted()
      for (let t = 0; t < tracks.length; t++) {
        const track = tracks[t]
        const i = f - track.start
        if (i < 0 || i >= track.boxes.length) continue
        const box = track.boxes[i]
        const w = (box.x2 - box.x1) * cropW
        const h = (box.y2 - box.y1) * cropH
        const size = Math.max(w, h)
        const cx = ((box.x1 + box.x2) / 2) * cropW
        const cy = ((box.y1 + box.y2) / 2) * cropH + CROP_DOWN_SHIFT * size
        await crops.push(t, cropFace(frame, cropW, cropH, cx, cy, Math.max(4, size * CROP_SIDE_FACTOR)))
        if (i === track.boxes.length - 1) await crops.finish(t)
      }
    },
    signal
  )
}

/** Extract clip audio as 16 kHz mono PCM and compute MFCC features. */
async function extractMfcc(
  videoPath: string,
  startSec: number,
  duration: number,
  signal?: AbortSignal
): Promise<Float32Array | null> {
  const pcmPath = join(tmpdir(), 'cutawan', `asd-${randomUUID()}.pcm`)
  try {
    await runFfmpeg(
      [
        '-ss', startSec.toFixed(3),
        '-t', duration.toFixed(3),
        '-i', videoPath,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-f', 's16le',
        pcmPath
      ],
      { signal }
    )
    const raw = await readFile(pcmPath)
    if (raw.length < 3200) return null // under 100 ms of audio
    const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))
    return computeMfcc(pcm, 16000).features
  } catch (err) {
    if (signal?.aborted) throw err
    return null
  } finally {
    await rm(pcmPath, { force: true }).catch(() => undefined)
  }
}

/**
 * MFCC feature rows for video frames [start, start+frames) — 4 audio feature
 * frames per video frame, padded by repeating the last row when the audio
 * runs out slightly before the video does.
 */
function mfccSlice(mfcc: Float32Array, start: number, frames: number): Float32Array {
  const total = Math.floor(mfcc.length / MFCC_COEFFS)
  const need = frames * 4
  const out = new Float32Array(need * MFCC_COEFFS)
  for (let i = 0; i < need; i++) {
    const src = Math.min(total - 1, start * 4 + i)
    out.set(mfcc.subarray(src * MFCC_COEFFS, (src + 1) * MFCC_COEFFS), i * MFCC_COEFFS)
  }
  return out
}

/** Mean smoothing over ±2 frames, as in the reference visualisation. */
function smoothScores(scores: Float32Array): number[] {
  const out = new Array<number>(scores.length)
  for (let i = 0; i < scores.length; i++) {
    const from = Math.max(0, i - 2)
    const to = Math.min(scores.length, i + 3)
    let sum = 0
    for (let j = from; j < to; j++) sum += scores[j]
    out[i] = sum / (to - from)
  }
  return out
}

/** Run the LR-ASD model over one face track, returning per-frame logits. */
async function scoreTrack(
  crops: FaceCrops,
  mfcc: Float32Array | null,
  trackStart: number,
  signal?: AbortSignal
): Promise<number[]> {
  const frames = crops.length
  const audio = mfcc
    ? mfccSlice(mfcc, trackStart, frames)
    : new Float32Array(frames * 4 * MFCC_COEFFS)

  const { embedA, embedV } = await encodeFaceTrack(join(modelsDir(), 'lr-asd-frontend.onnx'), crops, audio, signal)
  signal?.throwIfAborted()

  if (!mfcc) {
    // No soundtrack: use the visual-only head in bounded frame-wise batches.
    const scores = new Float32Array(frames)
    for (let from = 0; from < frames; from += 150) {
      const len = Math.min(150, frames - from)
      const out = await runInference(join(modelsDir(), 'lr-asd-backend.onnx'), {
        embedA: { data: embedA.slice(from * 128, (from + len) * 128), dims: [1, len, 128] },
        embedV: { data: embedV.slice(from * 128, (from + len) * 128), dims: [1, len, 128] }
      }, signal)
      scores.set(out.scoresV.data, from)
    }
    return smoothScores(scores)
  }

  const sum = new Float32Array(frames)
  let passes = 0
  for (const seconds of BACKEND_WINDOWS_SEC) {
    const window = seconds * ASD_FPS
    for (let from = 0; from < frames; from += window) {
      signal?.throwIfAborted()
      const len = Math.min(window, frames - from)
      const out = await runInference(join(modelsDir(), 'lr-asd-backend.onnx'), {
        embedA: { data: embedA.slice(from * 128, (from + len) * 128), dims: [1, len, 128] },
        embedV: { data: embedV.slice(from * 128, (from + len) * 128), dims: [1, len, 128] }
      }, signal)
      const scores = out.scoresAV.data as Float32Array
      for (let i = 0; i < len; i++) sum[from + i] += scores[i]
    }
    passes++
    if (window >= frames) break // longer windows would repeat the same pass
  }
  const avg = new Float32Array(frames)
  for (let i = 0; i < frames; i++) avg[i] = sum[i] / passes
  return smoothScores(avg)
}

/**
 * Full audio-visual analysis for one clip range. Returns null when the
 * LR-ASD models are not available (caller falls back to the motion
 * heuristic) or when no usable face tracks were found.
 */
export async function analyzeClipASD(
  videoPath: string,
  startSec: number,
  endSec: number,
  signal?: AbortSignal,
  comparison?: { detector?: 'ultraface' | 'yunet'; cropWidth?: number; detectStride?: number; fixedResolution?: boolean }
): Promise<AsdAnalysis | null> {
  if (!(await asdAvailable())) return null

  const duration = Math.max(0.1, endSec - startSec)
  const info = await probeVideo(videoPath)
  let useYuNet = comparison?.detector !== 'ultraface' && yunetAvailable()
  if (comparison?.detector === 'yunet' && !useYuNet) throw new Error('YuNet comparison model is unavailable')
  let detection: DetectionPass
  try {
    detection = await timed('asd/detect', () => runDetectionPass(videoPath, startSec, duration, signal,
      useYuNet ? faceDetectionSize(info.width, info.height) : undefined, comparison?.detectStride,
      !comparison?.fixedResolution), { duration })
  } catch (error) {
    if (!useYuNet || signal?.aborted || comparison?.detector === 'yunet') throw error
    console.error('High-resolution face detection failed; retrying with UltraFace:', error)
    useYuNet = false
    detection = await runDetectionPass(videoPath, startSec, duration, signal, undefined, comparison?.detectStride)
  }
  if (detection.frameCount === 0) return null

  const tracks = buildFaceTracks(detection.facesPerFrame, detection.sceneCuts, ASD_FPS)
  if (
    tracks.length === 0 ||
    trackCoverageRatio(tracks, detection.frameCount) < MIN_TRACK_COVERAGE
  ) {
    return {
      tracks: [],
      frameCount: detection.frameCount,
      sceneCuts: detection.sceneCuts,
      sceneTransitions: detection.sceneTransitions,
      fps: ASD_FPS,
      faceFrameRatio: detection.faceFrameRatio
    }
  }

  const nativeWidth = info.width || 640
  const cropW = Math.max(2, 2 * Math.floor(Math.min(nativeWidth, comparison?.cropWidth ??
    CROP_PASS_LONG_EDGE * nativeWidth / Math.max(nativeWidth, info.height || nativeWidth)) / 2))
  const cropH = Math.max(
    2,
    2 * Math.round((cropW * (info.height || cropW)) / Math.max(1, info.width || cropW) / 2)
  )
  const crops = await FaceCropStore.create(tracks.map(track => track.boxes.length))
  const scored: ScoredFaceTrack[] = []
  try {
    // Settle both processes before cleaning up their files on cancellation/failure.
    const [cropResult, audioResult] = await Promise.allSettled([
      timed('asd/crops', () => runCropPass(videoPath, startSec, duration, tracks, cropW, cropH, crops, signal),
        { duration, tracks: tracks.length, cropW }),
      info.hasAudio ? timed('asd/mfcc', () => extractMfcc(videoPath, startSec, duration, signal)) : Promise.resolve(null)
    ])
    if (cropResult.status === 'rejected') throw cropResult.reason
    if (audioResult.status === 'rejected') throw audioResult.reason
    const mfcc = audioResult.value
    await timed('asd/score', async () => {
      for (let t = 0; t < tracks.length; t++) {
        signal?.throwIfAborted()
        const track = tracks[t]
        const scores = await crops.read(t, frames => frames.length < 2 ? Promise.resolve([]) : scoreTrack(frames, mfcc, track.start, signal))
        const frames = scores.length
        if (frames < 2) continue
        scored.push({
          start: track.start,
          centres: track.boxes.slice(0, frames).map((b) => (b.x1 + b.x2) / 2),
          areas: track.boxes.slice(0, frames).map((b) => (b.x2 - b.x1) * (b.y2 - b.y1)),
          scores,
          boxes: track.boxes.slice(0, frames)
        })
      }
    }, { tracks: tracks.length, frames: tracks.reduce((sum, track) => sum + track.boxes.length, 0) })
  } finally { await crops.close() }
  return {
    tracks: scored,
    frameCount: detection.frameCount,
    sceneCuts: detection.sceneCuts,
    sceneTransitions: detection.sceneTransitions,
    fps: ASD_FPS,
    faceFrameRatio: detection.faceFrameRatio,
    cropSize: { width: cropW, height: cropH },
    detector: useYuNet ? 'yunet' : 'ultraface'
  }
}
