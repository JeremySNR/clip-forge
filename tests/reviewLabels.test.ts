import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { reviewPanelLabels } from '../src/main/pipeline/reviewLabels'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'

it('renders all three proof labels with spaces, apostrophes and graph delimiters in the font path', async () => {
  const dir = await mkdtemp(join(tmpdir(), "cutawan-O'Brien [proof], "))
  try {
    const font = join(dir, "Poppins 'Medium', [test];.ttf"), output = join(dir, 'labels.gray')
    await copyFile(join(process.cwd(), 'resources/fonts/Poppins-Medium.ttf'), font)
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=1360x672:r=1:d=1',
      '-vf', await reviewPanelLabels(dir, dir), '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', output])
    const pixels = await readFile(output)
    expect(pixels.length).toBe(1360 * 672)
    for (const [left, right] of [[0, 640], [640, 1000], [1000, 1360]]) {
      let ink = 0
      for (let y = 0; y < 32; y++) for (let x = left; x < right; x++) if (pixels[y * 1360 + x] > 100) ink++
      expect(ink).toBeGreaterThan(50)
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})
