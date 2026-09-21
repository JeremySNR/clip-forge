import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { temporalEdgeTimes } from '../src/main/pipeline/temporalEdges'
import { clipFrameTimes } from '../src/main/pipeline/visualScore'

it('finds a brief crop collision between uniform review frames, without conflating static borders', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cutawan-temporal-'))
  const video = join(directory, 'source.mp4'), region = { x: .2, y: .2, width: .6, height: .6 }
  try {
    // Persistent left border, then a brief title touching the upper crop edge.
    // Seven uniform samples of the interval 1–7s miss the event at 3.25–3.65s.
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=black:s=640x360:r=20:d=8',
      '-vf', "drawbox=x=125:y=120:w=6:h=100:color=white:t=fill,drawbox=x=230:y=67:w=140:h=12:color=white:t=fill:enable='between(t,3.25,3.65)'",
      '-c:v', 'mpeg4', video])
    const start = 1, end = 7
    expect(clipFrameTimes(start, end, 7).some(t => t >= 3.25 && t <= 3.65)).toBe(false)
    const times = await temporalEdgeTimes(video, start, end, region, false)
    expect(times.some(t => t >= 3.25 && t <= 3.65)).toBe(true)
    expect(times.every(t => t >= start && t < end)).toBe(true)
    expect(await temporalEdgeTimes(video, 0, 2, region, false)).toEqual([])
    expect((await temporalEdgeTimes(video, 0, 2, region, true)).length).toBeGreaterThan(0)
    await expect(temporalEdgeTimes(video, 7, 12, region, false)).rejects.toThrow('Incomplete')
    const controller = new AbortController(); controller.abort()
    await expect(temporalEdgeTimes(video, 0, 2, region, false, controller.signal)).rejects.toThrow()
    await expect(temporalEdgeTimes(video, 0, 121, region, false)).rejects.toThrow('120')
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 15000)
