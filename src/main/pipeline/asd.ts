import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import * as ort from 'onnxruntime-node'
import { runFfmpeg, streamRawFrames, probeVideo } from './ffmpeg'
import { computeMfcc, MFCC_COEFFS } from './mfcc'
import { buildFaceTracks, type FaceTrack } from './facetracks'
import { detectFaces, frameDifference, modelsDir, MODEL_W, MODEL_H } from './detect'
import type { FaceBox } from './speaker'

/**
 * Audio-visual active speaker detection with LR-ASD (Liao et al., IJCV 2025).
 *
 * The model watches each face's mouth region *and listens to the audio at the
 * same time*, scoring every face on every frame as speaking or silent. Unlike
 * the older mouth-motion heuristic it cannot be fooled by someone moving,
 * chewing, or touching their face while another person talks — the visual
 * stream has to correlate with the actual speech in the soundtrack. For
 * videos without an audio track the model's visual-only head is used instead.
 *
 * Per clip: sample frames at 25 fps, detect faces (UltraFace), build
 * per-person tracks, crop each track's mouth-centred square to 112x112
 * grayscale, extract 13-dim MFCC audio features (4 per video frame), then run
 * the two-stage ONNX model. Scores are raw class-1 logits: > 0 means
 * speaking, matching the reference implementation.
 */

export const ASD_FPS = 25
/** Run UltraFace on every Nth analysis frame; boxes in between interpolate. */
const DETECT_STRIDE = 2
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
/** Width the crop pass decodes at; faces are small fractions of the frame. */
const CROP_PASS_WIDTH = 640
/**
 * Consecutive-frame difference that counts as a camera cut. Lower than the
 * legacy 2 fps threshold (34): at 25 fps normal motion barely registers
 * between neighbouring frames, while even soft cuts and dissolves spike.
 */
const ASD_SCENE_CUT_THRESHOLD = 24
/** Cuts closer together than this are one transition (dissolves span frames). */
const CUT_MERGE_SEC = 0.3
/**
 * Screencasts and slide decks rarely have faces; scanning the whole clip at
 * 25 fps is slow and looks like a hang. After this many seconds, bail out
 * when detections are too sparse to ever produce a focus track.
 */
const FACE_PROBE_SEC = 8
/** Stop scanning once no face has been seen for this long (e.g. Zoom → screen share). */
const FACE_ABSENT_ABORT_SEC = 3
/** Minimum strided detection frames that must contain a face to keep scanning. */
const MIN_FACE_DETECTIONS = 3
/**
 * Tracks must cover at least this fraction of analysis frames before we run
 * the heavy crop + LR-ASD passes (buildFocusTrack needs ~30%).
 */
const MIN_TRACK_COVERAGE = 0.25

let sessionsPromise: Promise<{
  frontend: ort.InferenceSession
  backend: ort.InferenceSession
} | null> | null = null

/** Load the LR-ASD sessions, or null when the model files are not bundled. */
function getSessions(): Promise<{
  frontend: ort.InferenceSession
  backend: ort.InferenceSession
} | null> {
  sessionsPromise ??= (async () => {
    const frontendPath = join(modelsDir(), 'lr-asd-frontend.onnx')
    const backendPath = join(modelsDir(), 'lr-asd-backend.onnx')
    if (!existsSync(frontendPath) || !existsSync(backendPath)) return null
    const [frontend, backend] = await Promise.all([
      ort.InferenceSession.create(frontendPath, { logSeverityLevel: 3 }),
      ort.InferenceSession.create(backendPath, { logSeverityLevel: 3 })
    ])
    return { frontend, backend }
  })()
  return sessionsPromise
}

export function asdAvailable(): Promise<boolean> {
  return getSessions().then((s) => s !== null)
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
}

export interface AsdAnalysis {
  tracks: ScoredFaceTrack[]
  frameCount: number
  sceneCuts: number[]
  fps: number
}

interface DetectionPass {
  facesPerFrame: Array<FaceBox[] | null>
  sceneCuts: number[]
  frameCount: number
}

/** Whether face detection should stop early on sparse / absent faces (unit-tested). */
export function shouldAbortFaceDetection(
  frameIndex: number,
  detectionFrames: number,
  framesWithFaces: number,
  lastFaceFrame: number,
  fps: number = ASD_FPS
): boolean {
  const probeEnd = Math.round(FACE_PROBE_SEC * fps)
  const absentLimit = Math.round(FACE_ABSENT_ABORT_SEC * fps)
  const probeDetections = Math.ceil(probeEnd / DETECT_STRIDE)
  if (frameIndex >= probeEnd && detectionFrames >= probeDetections && framesWithFaces < MIN_FACE_DETECTIONS) {
    return true
  }
  if (lastFaceFrame >= 0 && frameIndex - lastFaceFrame >= absentLimit) return true
  return false
}

/** Fraction of analysis frames covered by face tracks (unit-tested). */
export function trackCoverageRatio(tracks: FaceTrack[], frameCount: number): number {
  let covered = 0
  for (const t of tracks) covered += t.boxes.length
  return covered / Math.max(1, frameCount)
}

/** Pass 1: stream small RGB frames; detect scene cuts and faces (strided). */
async function runDetectionPass(
  videoPath: string,
  startSec: number,
  duration: number,
  signal?: AbortSignal
): Promise<DetectionPass> {
  const facesPerFrame: Array<FaceBox[] | null> = []
  const rawCuts: number[] = []
  let prev: Buffer | null = null
  let detectionFrames = 0
  let framesWithFaces = 0
  let lastFaceFrame = -1
  let abortedEarly = false
  const passAbort = new AbortController()
  const onParentAbort = (): void => passAbort.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })

  try {
    await streamRawFrames(
      [
        '-ss', startSec.toFixed(3),
        '-t', duration.toFixed(3),
        '-i', videoPath,
        '-vf', `fps=${ASD_FPS},scale=${MODEL_W}:${MODEL_H}`,
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24'
      ],
      MODEL_W * MODEL_H * 3,
      async (frame, f) => {
        signal?.throwIfAborted()
        if (prev && frameDifference(prev, frame) > ASD_SCENE_CUT_THRESHOLD) rawCuts.push(f)
        if (f % DETECT_STRIDE === 0) {
          const faces = await detectFaces(frame)
          facesPerFrame.push(faces)
          detectionFrames++
          if (faces.length > 0) {
            framesWithFaces++
            lastFaceFrame = f
          }
        } else {
          facesPerFrame.push(null)
        }
        prev = Buffer.from(frame)
        if (shouldAbortFaceDetection(f, detectionFrames, framesWithFaces, lastFaceFrame)) {
          abortedEarly = true
          passAbort.abort()
        }
      },
      passAbort.signal
    )
  } catch (err) {
    if (!abortedEarly && !signal?.aborted) throw err
    signal?.throwIfAborted()
  } finally {
    signal?.removeEventListener('abort', onParentAbort)
  }

  // Keep the full clip length as the denominator after bailout; the skipped
  // suffix is effectively "no face", not "not part of the clip".
  const frameCount = abortedEarly
    ? Math.max(facesPerFrame.length, Math.round(duration * ASD_FPS))
    : facesPerFrame.length
  // A dissolve registers on several neighbouring frames; keep only the last
  // of each cluster (when the new shot has settled).
  const mergeWindow = Math.max(1, Math.round(CUT_MERGE_SEC * ASD_FPS))
  const sceneCuts = rawCuts.filter((cut, i) => i === rawCuts.length - 1 || rawCuts[i + 1] - cut > mergeWindow)
  return { facesPerFrame, sceneCuts, frameCount }
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
  signal?: AbortSignal
): Promise<Uint8Array[][]> {
  const crops: Uint8Array[][] = tracks.map(() => [])
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
    (frame, f) => {
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
        crops[t].push(cropFace(frame, cropW, cropH, cx, cy, Math.max(4, size * CROP_SIDE_FACTOR)))
      }
    },
    signal
  )
  return crops
}

/** Extract clip audio as 16 kHz mono PCM and compute MFCC features. */
async function extractMfcc(
  videoPath: string,
  startSec: number,
  duration: number,
  signal?: AbortSignal
): Promise<Float32Array | null> {
  const pcmPath = join(tmpdir(), 'clipforge', `asd-${randomUUID()}.pcm`)
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
  sessions: { frontend: ort.InferenceSession; backend: ort.InferenceSession },
  crops: Uint8Array[],
  mfcc: Float32Array | null,
  trackStart: number,
  signal?: AbortSignal
): Promise<number[]> {
  const frames = crops.length
  const video = new Float32Array(frames * CROP_SIZE * CROP_SIZE)
  for (let f = 0; f < frames; f++) {
    const crop = crops[f]
    const base = f * CROP_SIZE * CROP_SIZE
    for (let i = 0; i < crop.length; i++) video[base + i] = crop[i]
  }
  const audio = mfcc
    ? mfccSlice(mfcc, trackStart, frames)
    : new Float32Array(frames * 4 * MFCC_COEFFS)

  const embeds = await sessions.frontend.run({
    audio: new ort.Tensor('float32', audio, [1, frames * 4, MFCC_COEFFS]),
    video: new ort.Tensor('float32', video, [1, frames, CROP_SIZE, CROP_SIZE])
  })
  signal?.throwIfAborted()
  const embedA = embeds.embedA.data as Float32Array
  const embedV = embeds.embedV.data as Float32Array

  if (!mfcc) {
    // No soundtrack: use the visual-only head (frame-wise, no windowing).
    const out = await sessions.backend.run({
      embedA: new ort.Tensor('float32', embedA, [1, frames, 128]),
      embedV: new ort.Tensor('float32', embedV, [1, frames, 128])
    })
    return smoothScores(out.scoresV.data as Float32Array)
  }

  const sum = new Float32Array(frames)
  let passes = 0
  for (const seconds of BACKEND_WINDOWS_SEC) {
    const window = seconds * ASD_FPS
    for (let from = 0; from < frames; from += window) {
      signal?.throwIfAborted()
      const len = Math.min(window, frames - from)
      const out = await sessions.backend.run({
        embedA: new ort.Tensor(
          'float32',
          embedA.subarray(from * 128, (from + len) * 128),
          [1, len, 128]
        ),
        embedV: new ort.Tensor(
          'float32',
          embedV.subarray(from * 128, (from + len) * 128),
          [1, len, 128]
        )
      })
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
  signal?: AbortSignal
): Promise<AsdAnalysis | null> {
  const sessions = await getSessions()
  if (!sessions) return null

  const duration = Math.max(0.1, endSec - startSec)
  const info = await probeVideo(videoPath)
  const detection = await runDetectionPass(videoPath, startSec, duration, signal)
  if (detection.frameCount === 0) return null

  const tracks = buildFaceTracks(detection.facesPerFrame, detection.sceneCuts, ASD_FPS)
  if (
    tracks.length === 0 ||
    trackCoverageRatio(tracks, detection.frameCount) < MIN_TRACK_COVERAGE
  ) {
    return { tracks: [], frameCount: detection.frameCount, sceneCuts: detection.sceneCuts, fps: ASD_FPS }
  }

  const cropW = Math.min(CROP_PASS_WIDTH, info.width || CROP_PASS_WIDTH)
  const cropH = Math.max(
    2,
    2 * Math.round((cropW * (info.height || cropW)) / Math.max(1, info.width || cropW) / 2)
  )
  const [crops, mfcc] = await Promise.all([
    runCropPass(videoPath, startSec, duration, tracks, cropW, cropH, signal),
    info.hasAudio ? extractMfcc(videoPath, startSec, duration, signal) : Promise.resolve(null)
  ])

  const scored: ScoredFaceTrack[] = []
  for (let t = 0; t < tracks.length; t++) {
    signal?.throwIfAborted()
    const track = tracks[t]
    const frames = Math.min(track.boxes.length, crops[t].length)
    if (frames < 2) continue
    const scores = await scoreTrack(
      sessions,
      crops[t].slice(0, frames),
      mfcc,
      track.start,
      signal
    )
    scored.push({
      start: track.start,
      centres: track.boxes.slice(0, frames).map((b) => (b.x1 + b.x2) / 2),
      areas: track.boxes.slice(0, frames).map((b) => (b.x2 - b.x1) * (b.y2 - b.y1)),
      scores
    })
  }
  return {
    tracks: scored,
    frameCount: detection.frameCount,
    sceneCuts: detection.sceneCuts,
    fps: ASD_FPS
  }
}
