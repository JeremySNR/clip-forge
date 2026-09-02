/**
 * Bitrate planning for renders that must land under a hard byte cap, for
 * services that reject large request bodies (WorkVivo's Customer API answers
 * HTTP 413; the cap is undocumented, see `WORKVIVO_DEFAULT_UPLOAD_CAP_BYTES`).
 *
 * The point of planning up front is that the render can then be a *single*
 * size-targeted encode straight from the source. Rendering at a quality target
 * and re-compressing afterwards costs a second lossy generation, and the
 * second encoder wastes bits faithfully reproducing the first one's blocking
 * and ringing instead of the picture.
 */

/** Container overhead, moov atom and multipart form fields we refuse to spend. */
const OVERHEAD_FRACTION = 0.03

/**
 * Bits per pixel per frame below which x264 starts to visibly fall apart on
 * this kind of footage. Measured against `slow` two-pass on captioned
 * talking-head clips, which are low-motion but carry sharp text overlays.
 * Below this the budget buys a better picture at a smaller frame size.
 */
const TARGET_BITS_PER_PIXEL = 0.04

/** Never upsample, and never scale by a margin too small to be worth it. */
const MAX_SCALE = 1
const NEGLIGIBLE_SCALE = 0.95

/**
 * Floor on downscaling. Past this the clip is simply too long for the cap and
 * the honest answer is a shorter clip, not a smaller picture.
 */
const MIN_SCALE = 0.4

/** Social video is 30fps at most; a 60fps source doubles cost for nothing. */
const MAX_FPS = 30

/** Speech-only audio; 128k AAC is transparent enough and 96k still fine. */
const AUDIO_KBPS = 128
const AUDIO_KBPS_TIGHT = 96
/** Below this total budget the audio allocation starts to matter. */
const TIGHT_TOTAL_KBPS = 900

/** x264 gives up on anything meaningful below roughly this. */
const MIN_VIDEO_KBPS = 150

export interface UploadEncodeInput {
  /** Hard ceiling for the finished file, in bytes. */
  capBytes: number
  /** Duration of the *output* (after tighten-cuts), in seconds. */
  durationSec: number
  /** Frame size the render would use if size were no object. */
  width: number
  height: number
  sourceFps: number
  hasAudio: boolean
}

export interface UploadEncodePlan {
  /** Average video bitrate for the two-pass encode, in kbit/s. */
  videoKbps: number
  /** Audio bitrate in kbit/s; 0 when the clip is silent. */
  audioKbps: number
  /** Frame size to encode at. Even numbers, so yuv420p is always valid. */
  width: number
  height: number
  fps: number
  /** True when the budget forced a smaller frame than requested. */
  downscaled: boolean
  /** What the plan expects the file to weigh, in bytes. */
  estimatedBytes: number
  /**
   * True when even `MIN_SCALE` cannot reach `TARGET_BITS_PER_PIXEL`. The
   * render still goes ahead, but the caller may want to warn.
   */
  overBudget: boolean
}

/** Round to an even number (yuv420p needs it), never below 2. */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2)
}

/**
 * Work the encode backwards from the byte cap: how many bits per second are
 * available, and what frame size those bits can actually carry.
 */
export function planUploadEncode(input: UploadEncodeInput): UploadEncodePlan {
  const durationSec = Math.max(0.5, input.durationSec)
  const width = even(Math.max(2, input.width))
  const height = even(Math.max(2, input.height))
  // A source with a broken or missing frame rate should not produce NaN.
  const sourceFps = Number.isFinite(input.sourceFps) && input.sourceFps > 0 ? input.sourceFps : MAX_FPS
  const fps = Math.min(sourceFps, MAX_FPS)

  const budgetBits = Math.max(0, input.capBytes) * 8 * (1 - OVERHEAD_FRACTION)
  const totalKbps = budgetBits / durationSec / 1000
  const audioKbps = !input.hasAudio ? 0 : totalKbps < TIGHT_TOTAL_KBPS ? AUDIO_KBPS_TIGHT : AUDIO_KBPS

  const videoKbps = Math.max(MIN_VIDEO_KBPS, Math.floor(totalKbps - audioKbps))

  // Bits per pixel per frame at the requested frame size. Below the target the
  // same bits buy a better picture spread over fewer pixels.
  const pixelsPerSecond = width * height * fps
  const bitsPerPixel = (videoKbps * 1000) / pixelsPerSecond
  const idealScale = Math.sqrt(bitsPerPixel / TARGET_BITS_PER_PIXEL)
  const overBudget = idealScale < MIN_SCALE
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, idealScale))
  const downscaled = scale < NEGLIGIBLE_SCALE

  const outWidth = downscaled ? even(width * scale) : width
  const outHeight = downscaled ? even(height * scale) : height

  const estimatedBytes = Math.round(((videoKbps + audioKbps) * 1000 * durationSec) / 8)

  return {
    videoKbps,
    audioKbps,
    width: outWidth,
    height: outHeight,
    fps,
    downscaled,
    estimatedBytes,
    overBudget
  }
}
