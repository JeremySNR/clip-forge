import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probeImageDimensions, probeVideo, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { fitRegionGraph } from '../src/main/pipeline/layoutFilters'

describe('media dimensions used for verified composition', () => {
  it('reads still-frame dimensions without requiring a video duration', async () => {
    const image = join(process.cwd(), 'build', 'icon.png')
    const size = await probeImageDimensions(image)
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
    await expect(probeVideo(image)).rejects.toThrow('Could not determine video duration')
  })

  it('uses displayed dimensions for rotated video and its region crop', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cutawan-probe-'))
    try {
      const source = join(dir, 'source.mp4')
      const rotated = join(dir, 'rotated.mp4')
      const frame = join(dir, 'frame.jpg')
      await runFfmpeg(['-f', 'lavfi', '-i', 'color=s=320x180:d=0.2', '-c:v', 'mpeg4', source])
      await runFfmpeg(['-display_rotation', '90', '-i', source, '-c', 'copy', rotated])
      const info = await probeVideo(rotated)
      expect({ width: info.width, height: info.height }).toEqual({ width: 180, height: 320 })
      await runFfmpeg(['-i', rotated, '-frames:v', '1', frame])
      expect(await probeImageDimensions(frame)).toEqual({ width: 180, height: 320 })
      const graph = fitRegionGraph('0:v', 'out', 'region', info, 360, 640,
        { x: 0.2, y: 0.2, width: 0.6, height: 0.6 })
      await expect(runFfmpeg(['-i', rotated, '-filter_complex', graph,
        '-map', '[out]', '-frames:v', '1', '-f', 'null', '-'])).resolves.toBeDefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 15000)
})
