import type { ContentRegion } from '@shared/types'
import { contentEdgeRisks } from './contentEdges'
import { streamRawFrames } from './ffmpeg'
import { mediaJobs } from './mediaJobs'

/** Local evidence only: scan at four frames/sec, retaining no images. Fresh
 * proposals flag a new edge collision after a clear frame; reused proposals
 * also flag collisions present at the start. Static UI borders are not proof
 * of clipping. Low-contrast features and faster events can still be missed. */
export async function temporalEdgeTimes(video: string, start: number, end: number,
  region: ContentRegion, strict: boolean, signal?: AbortSignal): Promise<number[]> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 120) {
    return Promise.reject(new Error('Temporal layout review requires a shot of at most 120 seconds.'))
  }
  return mediaJobs.run(async () => {
    let clearEdges = 0
    const events: number[] = []
    const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)])
    const count = await streamRawFrames(['-ss', String(start), '-t', String(end - start), '-i', video,
      '-vf', 'fps=4:start_time=0,scale=640:360', '-an', '-pix_fmt', 'gray', '-f', 'rawvideo'],
    640 * 360, (pixels, index) => {
      const risks = contentEdgeRisks(pixels, region), time = start + index / 4
      clearEdges |= ~risks & 15
      if ((strict ? risks : risks & clearEdges) && !events.length) events.push(time)
    }, bounded)
    if (count < Math.max(1, Math.floor((end - start) * 4) - 1)) {
      throw new Error('Incomplete temporal layout review; the source did not cover the requested interval.')
    }
    // The fps filter can choose a nearby source timestamp. Include both sides
    // when requesting new bounds rather than pretending timing is exact.
    return events.flatMap(time => [-.25, 0, .25].map(offset =>
      Math.max(start, Math.min(end - Math.min(.05, (end - start) / 2), time + offset))))
  }, signal)
}
