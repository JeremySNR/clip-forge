import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { fitRegionGraph } from '../src/main/pipeline/layoutFilters'
import { blurredFitShot } from '@shared/contentType'

it('fills the bars of a camera fit with a blurred copy, full frame or region', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-blur-fit-'))
  try {
    const source = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x3080f0:s=1920x1080:r=5:d=1', '-c:v', 'mpeg4', source])
    for (const region of [undefined, { x: 0.25, y: 0.2, width: 0.5, height: 0.6 }]) {
      const out = join(dir, `frame-${region ? 'region' : 'full'}.rgb`)
      const graph = fitRegionGraph('0:v', 'out', 'p', { width: 1920, height: 1080 }, 1080, 1920, region, false, true)
      await runFfmpeg(['-i', source, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', out])
      const rgb = await readFile(out)
      expect(rgb.length).toBe(1080 * 1920 * 3)
      // The top-left corner sits in what used to be a black bar.
      expect(rgb[2]).toBeGreaterThan(100)
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)

it('keeps black canvases for screens, overviews and compositions', () => {
  const camera = { visualLayout: { start: 0, end: 1, preserveContext: true, allowZoom: false, reason: '', kind: 'camera' as const } }
  expect(blurredFitShot(camera, { start: 0, end: 1, mode: 'fit' })).toBe(true)
  expect(blurredFitShot(camera, { start: 0, end: 1, mode: 'crop' })).toBe(false)
  expect(blurredFitShot(camera, { start: 0, end: 1, mode: 'fit', overview: true, region: { x: 0, y: 0, width: .5, height: .5 } })).toBe(false)
  expect(blurredFitShot({ visualLayout: { ...camera.visualLayout, kind: 'screen' } }, { start: 0, end: 1, mode: 'fit' })).toBe(false)
})
