import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { screenTransitions } from '../src/main/pipeline/screenCuts'

it('locates screen changes in source time and bounds decoding to the selected interval', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-screen-cuts-'))
  try {
    const video = join(dir, 'cuts.mp4')
    await runFfmpeg(['-f','lavfi','-i','color=black:s=320x180:r=20:d=2',
      '-f','lavfi','-i','color=white:s=320x180:r=20:d=2',
      '-f','lavfi','-i','color=black:s=320x180:r=20:d=2',
      '-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[out]',
      '-map','[out]','-c:v','mpeg4',video])
    const transitions = await screenTransitions(video, 1, 3)
    expect(transitions).toHaveLength(1)
    expect(transitions[0].start).toBeLessThanOrEqual(2)
    expect(transitions[0].end).toBeGreaterThanOrEqual(2)
    expect(transitions[0].end).toBeLessThan(3)
    expect(await screenTransitions(video, 2.5, 3.5)).toEqual([])
    const transient = await screenTransitions(video, 0, 6)
    expect(transient).toHaveLength(1)
    expect(transient[0].start).toBeLessThan(2)
    expect(transient[0].end).toBeGreaterThan(4)
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 15000)
