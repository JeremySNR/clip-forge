import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { FocusKeyframe, ClipContentType, ClipEditState } from '@shared/types'
import { classifyClipContent, editDefaultsForContentType } from '@shared/contentType'
import { mapLimit } from './concurrency'
import { runFfmpeg } from './ffmpeg'
import { analyzeClipASD } from './asd'
import { detectFaces, frameDifference, MODEL_H, MODEL_W, SCENE_CUT_THRESHOLD } from './detect'
import {
  chooseFocusCentres,
  chooseSpeakerByScores,
  mouthActivity,
  type FaceBox
} from './speaker'

/**
 * Face-based auto reframing. The primary path runs audio-visual active
 * speaker detection (LR-ASD, see asd.ts): faces are detected with UltraFace,
 * tracked per person, and every track is scored frame-by-frame against the
 * clip's audio — the crop follows whoever is actually speaking, never someone
 * who merely moves or gestures.
 *
 * The result is a focus track of stable segments: hard cuts at camera cuts and
 * speaker switches (the way social clipping tools reframe multi-speaker
 * footage), smooth pans when the same person moves within a shot (see
 * shared/focusTrack.ts). When the ASD models are missing, the legacy visual
 * heuristic (mouth-region motion at 2 fps) is used instead.
 */

const SAMPLE_FPS = 2
/** Minimum focus shift (normalized) that justifies a cut to a new segment. */
const SEGMENT_SHIFT_THRESHOLD = 0.1
/** A shift must persist this long before we cut (frames = sec * fps). */
const SEGMENT_MIN_SEC = 1.5
/** Median-smoothing window over per-frame centres, in seconds. */
const SMOOTH_SEC = 2.5
/** Concurrent UltraFace inferences per clip (each is small; 4 keeps CPU busy). */
const FACE_INFERENCE_CONCURRENCY = 4

interface SampledFrames {
  centres: Array<number | null>
  /** Frame indices where a shot change was detected. */
  cuts: number[]
}

/**
 * Legacy heuristic: per-frame primary-face centres from mouth-region motion,
 * sampled at 2 fps. Used only when the LR-ASD models are unavailable.
 */
async function sampleFaceCentres(
  videoPath: string,
  startSec: number,
  endSec: number,
  signal?: AbortSignal
): Promise<SampledFrames> {
  const duration = Math.max(0.1, endSec - startSec)
  const rawPath = join(tmpdir(), 'clipforge', `faces-${randomUUID()}.rgb`)
  await runFfmpeg(
    [
      '-ss', startSec.toFixed(3),
      '-t', duration.toFixed(3),
      '-i', videoPath,
      '-vf', `fps=${SAMPLE_FPS},scale=${MODEL_W}:${MODEL_H}`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      rawPath
    ],
    { signal }
  )
  try {
    const raw = await readFile(rawPath)
    const frameBytes = MODEL_W * MODEL_H * 3
    const frameCount = Math.floor(raw.length / frameBytes)
    const frames = Array.from({ length: frameCount }, (_, f) =>
      raw.subarray(f * frameBytes, (f + 1) * frameBytes)
    )

    // Scene cuts need consecutive frame pairs; this pass is cheap.
    const sceneCuts: number[] = []
    for (let f = 1; f < frameCount; f++) {
      if (frameDifference(frames[f - 1], frames[f]) > SCENE_CUT_THRESHOLD) sceneCuts.push(f)
    }

    // Face detection per frame is independent — run inferences concurrently
    // (ONNX Runtime queues session.run calls safely across its thread pool).
    const facesPerFrame: FaceBox[][] = new Array(frameCount).fill(null).map(() => [])
    const completedFrames = new Array<boolean>(frameCount).fill(false)
    let detectionFrames = 0
    let framesWithFaces = 0
    let lastFaceFrame = -1
    let processedThrough = -1
    let abortedEarly = false
    let effectiveCount = frameCount
    const probeEnd = Math.round(8 * SAMPLE_FPS)
    const absentLimit = Math.round(3 * SAMPLE_FPS)
    await mapLimit(frames, FACE_INFERENCE_CONCURRENCY, async (frame, f) => {
      if (abortedEarly && f >= effectiveCount) return
      signal?.throwIfAborted()
      const faces = await detectFaces(frame)
      facesPerFrame[f] = faces
      completedFrames[f] = true
      if (abortedEarly) return

      // Concurrent inferences finish out of order; only make bailout decisions
      // from a contiguous analysed prefix so no frame inside it is skipped.
      while (processedThrough + 1 < frameCount && completedFrames[processedThrough + 1]) {
        processedThrough++
        detectionFrames++
        if (facesPerFrame[processedThrough].length > 0) {
          framesWithFaces++
          lastFaceFrame = processedThrough
        }
      }
      if (
        (processedThrough >= probeEnd && detectionFrames >= probeEnd && framesWithFaces < 3) ||
        (lastFaceFrame >= 0 && processedThrough - lastFaceFrame >= absentLimit)
      ) {
        abortedEarly = true
        effectiveCount = Math.min(frameCount, processedThrough + 1, Math.max(lastFaceFrame + 1, probeEnd))
      }
    })

    const trimmedFaces = facesPerFrame.slice(0, effectiveCount)
    const trimmedFrames = frames.slice(0, effectiveCount)
    const trimmedCuts = sceneCuts.filter((c) => c < effectiveCount)

    // Mouth-movement activity per face — the visual speech signal that lets
    // the focus follow whoever is talking rather than whoever is biggest.
    const activityPerFrame: number[][] = trimmedFaces.map((faces, f) =>
      f === 0 || trimmedCuts.includes(f)
        ? faces.map(() => 0)
        : faces.map((box) => mouthActivity(trimmedFrames[f - 1], trimmedFrames[f], box, MODEL_W, MODEL_H))
    )

    const { centres: analysedCentres, switchCuts } = chooseFocusCentres(trimmedFaces, activityPerFrame, trimmedCuts)
    const centres =
      analysedCentres.length < frameCount
        ? analysedCentres.concat(new Array<number | null>(frameCount - analysedCentres.length).fill(null))
        : analysedCentres
    const cuts = [...new Set([...trimmedCuts, ...switchCuts])].sort((a, b) => a - b)
    return { centres, cuts }
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
 * Turn per-frame centres into a piecewise-constant focus track. Camera cuts
 * split the analysis into independent runs — smoothing never bleeds across a
 * shot change, and every cut gets an immediate refocus keyframe. Returns null
 * when too few faces were found to be useful (caller falls back to manual).
 */
export function buildFocusTrack(
  centres: Array<number | null>,
  clipStartSec: number,
  cuts: number[] = [],
  fps: number = SAMPLE_FPS
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

  const smoothWindow = Math.round(SMOOTH_SEC * fps) | 1
  const keyframes: FocusKeyframe[] = []
  const runBounds = [0, ...cuts.filter((c) => c > 0 && c < filled.length), filled.length]
  for (let r = 0; r < runBounds.length - 1; r++) {
    const runStart = runBounds[r]
    const run = filled.slice(runStart, runBounds[r + 1])
    if (run.length === 0) continue
    trackRun(medianSmooth(run, Math.min(smoothWindow, run.length)), runStart, clipStartSec, fps, keyframes)
  }
  return keyframes
}

/** Segment one continuous shot into stable focus positions. */
function trackRun(
  smooth: number[],
  runStartFrame: number,
  clipStartSec: number,
  fps: number,
  out: FocusKeyframe[]
): void {
  const minFrames = Math.max(2, Math.round(SEGMENT_MIN_SEC * fps))
  let segmentStart = 0
  let segmentValues = [smooth[0]]
  let shiftRun = 0

  const emit = (fromFrame: number): void => {
    // Median, not mean: a couple of transition frames must not drag the crop
    // to an in-between position (which looks like the frame "searching" for
    // the face). The median sits on the face the segment actually settled on.
    const sorted = [...segmentValues].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    out.push({
      t: clipStartSec + (runStartFrame + fromFrame) / fps,
      x: Math.min(1, Math.max(0, median)),
      // A run starts at a camera cut or speaker switch — the crop snaps
      // there. Later keyframes in the run are the same person moving within
      // the shot, which the samplers follow with a smooth pan (focusTrack.ts).
      cut: fromFrame === 0
    })
  }

  for (let i = 1; i < smooth.length; i++) {
    const segMean = segmentValues.reduce((a, b) => a + b, 0) / segmentValues.length
    if (Math.abs(smooth[i] - segMean) > SEGMENT_SHIFT_THRESHOLD) {
      shiftRun++
      if (shiftRun >= minFrames) {
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
}

export interface ClipFocusAnalysis {
  focusTrack: FocusKeyframe[] | null
  contentType: ClipContentType
}

/**
 * Full auto-reframe analysis for one clip. Returns null focus track when the
 * footage has no usable faces (e.g. screencasts) so the UI can fall back to
 * manual / letterbox framing.
 */
export async function analyzeClipFocus(
  videoPath: string,
  startSec: number,
  endSec: number,
  signal?: AbortSignal
): Promise<ClipFocusAnalysis> {
  try {
    const asd = await analyzeClipASD(videoPath, startSec, endSec, signal)
    if (asd) {
      const faceCoverage = asd.faceFrameRatio
      if (asd.tracks.length === 0) {
        return { focusTrack: null, contentType: classifyClipContent(faceCoverage, false) }
      }
      const { centres, switchCuts } = chooseSpeakerByScores(
        asd.tracks,
        asd.frameCount,
        asd.sceneCuts,
        asd.fps
      )
      const cuts = [...new Set([...asd.sceneCuts, ...switchCuts])].sort((a, b) => a - b)
      const focusTrack = buildFocusTrack(centres, startSec, cuts, asd.fps)
      return {
        focusTrack,
        contentType: classifyClipContent(faceCoverage, focusTrack !== null)
      }
    }
  } catch (err) {
    if (signal?.aborted) throw err
    console.error('Active speaker analysis failed, falling back to motion heuristic:', err)
  }

  try {
    const { centres, cuts } = await sampleFaceCentres(videoPath, startSec, endSec, signal)
    const detected = centres.filter((c): c is number => c !== null).length
    const faceCoverage = centres.length > 0 ? detected / centres.length : 0
    const focusTrack = buildFocusTrack(centres, startSec, cuts)
    return {
      focusTrack,
      contentType: classifyClipContent(faceCoverage, focusTrack !== null)
    }
  } catch (err) {
    if (signal?.aborted) throw err
    console.error('Face analysis failed, falling back to manual focus:', err)
    return { focusTrack: null, contentType: 'screencast' }
  }
}

/** Apply screencast-aware layout defaults onto a clip after focus analysis. */
export function applyFocusAnalysis(
  clip: {
    focusTrack: FocusKeyframe[] | null
    contentType?: ClipContentType | null
    edit: ClipEditState
  },
  analysis: ClipFocusAnalysis
): void {
  clip.focusTrack = analysis.focusTrack
  clip.contentType = analysis.contentType
  if (analysis.contentType === 'screencast') {
    clip.edit = editDefaultsForContentType(clip.edit, 'screencast')
    return
  }
  if (analysis.focusTrack) {
    clip.edit.framing = 'auto'
    clip.edit.focusX = analysis.focusTrack[0]?.x ?? 0.5
  }
}
