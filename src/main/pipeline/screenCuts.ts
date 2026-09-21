import { FFMPEG_PATH, runBinaryFull } from './ffmpeg'
import { mediaJobs, mediaThreads } from './mediaJobs'

/** Detect large screen changes without decoding faces or running any model.
 * Input-side duration is essential: output-side -t after select can decode
 * minutes beyond the requested interval while waiting for the next cut. */
export function screenTransitions(video: string, start: number, end: number, signal?: AbortSignal):
  Promise<Array<{ start: number; end: number }>> {
  return mediaJobs.run(async () => {
    const { stderr } = await runBinaryFull(FFMPEG_PATH, ['-hide_banner', '-nostats',
      '-threads', String(mediaThreads()), '-ss', String(start), '-t', String(end - start), '-i', video,
      '-vf', "fps=4,scale=160:-2,select='gt(scene,0.06)',showinfo", '-an', '-f', 'null', '-'], { signal })
    const times = [...stderr.matchAll(/\bn:\s*\d+\s+pts:\s*\d+\s+pts_time:([\d.]+)/g)]
      .map(match => start + Number(match[1])).filter(time => time > start && time < end)
    // Protect both sides of the quarter-second sampling uncertainty.
    const ranges: Array<{ start: number; end: number }> = []
    for (const time of times) {
      const range = { start: Math.max(start, time - .3), end: Math.min(end, time + .3) }
      const last = ranges.at(-1)
      // Treat brief dialogs/app switching as one unsettled interval. Apart
      // from avoiding flicker, this avoids AI calls for sub-two-second panels.
      if (last && range.start - last.end < 2) last.end = range.end
      else ranges.push(range)
    }
    return ranges
  }, signal)
}
