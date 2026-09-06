import { FFMPEG_PATH, runBinaryFull } from './ffmpeg'

/**
 * Two-pass loudness normalisation.
 *
 * ffmpeg's loudnorm filter has two modes. Given nothing but a target it runs
 * in "dynamic" mode: a look-ahead gain rider that chases the target through
 * the clip. On speech that is audible as pumping — quiet asides swell, the
 * tail of a loud line ducks. Given the input's measured loudness it can
 * instead apply one linear gain for the whole clip (with true-peak limiting
 * only where needed), which is transparent. That is what every mastering
 * chain does and what this module makes the export do: measure first, then
 * normalise with the measurements.
 *
 * Social platforms normalise to about -14 LUFS, so exports master to match.
 */

export const TARGET_I = -14
export const TARGET_TP = -1.5
export const TARGET_LRA = 11

export interface LoudnessStats {
  inputI: number
  inputTp: number
  inputLra: number
  inputThresh: number
  targetOffset: number
}

const TARGETS = `I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}`

/** The measurement filter, for a first pass whose output is discarded. */
export const MEASURE_FILTER = `loudnorm=${TARGETS}:print_format=json`

/**
 * The normalising filter. With measurements it runs linear (one gain for the
 * whole clip); without, it falls back to the single-pass dynamic mode. Pure
 * and exported for tests.
 */
export function loudnormFilter(stats: LoudnessStats | null): string {
  if (!stats) return `loudnorm=${TARGETS}`
  const f = (v: number): string => v.toFixed(2)
  return (
    `loudnorm=${TARGETS}` +
    `:measured_I=${f(stats.inputI)}:measured_TP=${f(stats.inputTp)}` +
    `:measured_LRA=${f(stats.inputLra)}:measured_thresh=${f(stats.inputThresh)}` +
    `:offset=${f(stats.targetOffset)}:linear=true`
  )
}

/**
 * Pull the measurement block out of ffmpeg's stderr. loudnorm prints it as a
 * JSON object of string values after the encode log; the last `{…}` in the
 * output is it. Returns null when the block is missing or any value is not a
 * finite number (silent input reports "-inf"), in which case the caller
 * should fall back to the single-pass filter. Pure and exported for tests.
 */
export function parseLoudnormStats(stderr: string): LoudnessStats | null {
  const close = stderr.lastIndexOf('}')
  if (close === -1) return null
  const open = stderr.lastIndexOf('{', close)
  if (open === -1) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(stderr.slice(open, close + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  const num = (key: string): number | null => {
    const v = Number(raw[key])
    return Number.isFinite(v) ? v : null
  }
  const inputI = num('input_i')
  const inputTp = num('input_tp')
  const inputLra = num('input_lra')
  const inputThresh = num('input_thresh')
  const targetOffset = num('target_offset')
  if (
    inputI === null ||
    inputTp === null ||
    inputLra === null ||
    inputThresh === null ||
    targetOffset === null
  ) {
    return null
  }
  return { inputI, inputTp, inputLra, inputThresh, targetOffset }
}

/**
 * Measure the loudness of a span of the source's audio. Failures (no audio
 * stream, silent input, an odd ffmpeg build) return null so the render can
 * still proceed with the single-pass filter — measurement improves the
 * export, it must never block it.
 */
export async function measureLoudness(
  sourcePath: string,
  startSec: number,
  durationSec: number,
  signal?: AbortSignal
): Promise<LoudnessStats | null> {
  try {
    const { stderr } = await runBinaryFull(
      FFMPEG_PATH,
      [
        '-hide_banner',
        '-nostats',
        '-ss', startSec.toFixed(3),
        '-t', durationSec.toFixed(3),
        '-i', sourcePath,
        '-vn',
        '-af', MEASURE_FILTER,
        '-f', 'null', '-'
      ],
      { signal }
    )
    return parseLoudnormStats(stderr)
  } catch (err) {
    if (signal?.aborted) throw err
    console.error('Loudness measurement failed; using single-pass normalisation:', err)
    return null
  }
}
