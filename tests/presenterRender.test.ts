import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { Clip } from '@shared/types'
import { compositionPixels, presenterComposition } from '@shared/composition'
import { FFPROBE_PATH, probeVideo, runBinary, runFfmpeg } from '../src/main/pipeline/ffmpeg'
import { renderClip } from '../src/main/pipeline/render'

it('exports original crops from all corners, switches at the right time, and keeps one audio stream', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-presenter-render-'))
  try {
    for (const [i, [x, y]] of [[.02, .02], [.82, .02], [.02, .72], [.82, .72]].entries()) {
      const sourcePath = join(dir, `source-${i}.mp4`)
      const content = { x: .2, y: .3, width: .6, height: .6 }
      const presenter = { x, y, width: .16, height: .26 }
      const filters = `drawbox=x=256:y=216:w=768:h=432:color=blue:t=fill,drawbox=x=${Math.floor(x * 1280)}:y=${Math.floor(y * 720)}:w=205:h=188:color=red:t=fill`
      await runFfmpeg(['-f', 'lavfi', '-i', 'color=black:size=1280x720:rate=5:duration=3',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-vf', filters, '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', sourcePath])
      const source = await probeVideo(sourcePath)
      const composition = presenterComposition(content, presenter, i % 2 ? 'stacked' : 'content-first')!
      const clip: Clip = { id: 'test', title: '', hook: '', summary: '', broll: [], focusTrack: null,
        suggestedStart: 1, suggestedEnd: 2, viralityScore: 0, viralityReason: '', visualSummary: null, hashtags: [], thumbnailPath: null,
        edit: { aspect: '9:16', framing: 'auto', reframeMode: 'crop', focusX: .5, captionStyleId: 'clean', showTitle: false,
          start: 1, end: 2, captionsEnabled: false, autoZoom: false, tightenCuts: false },
        visualLayout: { start: 1, end: 2, preserveContext: true, allowZoom: false, reason: 'fixture',
          shots: [{ start: 1, end: 1.4, mode: 'fit' }, { start: 1.4, end: 2, mode: 'fit', composition }] } }
      const outputPath = join(dir, `output-${i}.mp4`)
      const result = await renderClip({ clip, source, transcript: null, outputPath, encoder: 'cpu', quality: 'draft' })
      expect(result.outputPath).toBe(outputPath)
      const info = await probeVideo(outputPath)
      expect([info.width, info.height]).toEqual([1080, 1920])
      expect(Math.abs(info.durationSec - 1)).toBeLessThan(.1)
      const rawPath = join(dir, `frame-${i}.rgb`)
      await runFfmpeg(['-ss', '0.6', '-i', outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath])
      const raw = await readFile(rawPath)
      for (const [layer, pixel] of compositionPixels(composition, source, 1080, 1920).entries()) {
        const d = pixel.target
        const offset = (Math.floor(d.y + d.height / 2) * 1080 + Math.floor(d.x + d.width / 2)) * 3
        const rgb = [...raw.subarray(offset, offset + 3)]
        expect(rgb[layer === 0 ? 2 : 0]).toBeGreaterThan(200)
        expect(rgb[1]).toBeLessThan(30)
      }
      await runFfmpeg(['-ss', '0.2', '-i', outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath])
      const before = await readFile(rawPath)
      const inset = compositionPixels(composition, source, 1080, 1920)[1].target
      const at = (Math.floor(inset.y + inset.height / 2) * 1080 + Math.floor(inset.x + inset.width / 2)) * 3
      expect(Math.max(...before.subarray(at, at + 3))).toBeLessThan(10)
      const streams = JSON.parse(await runBinary(FFPROBE_PATH, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', outputPath]))
      expect(streams.streams.filter((s: { codec_type: string }) => s.codec_type === 'audio')).toHaveLength(1)
      if (i === 0) {
        const capped = await renderClip({ clip, source, transcript: null, outputPath: join(dir, 'capped.mp4'), sizeTargetBytes: 20000 })
        expect(capped.sizePlan?.downscaled).toBe(true)
        const cappedInfo = await probeVideo(capped.outputPath)
        expect([cappedInfo.width, cappedInfo.height]).toEqual([capped.sizePlan!.width, capped.sizePlan!.height])
        expect(cappedInfo.hasAudio).toBe(true)
      }
    }
    expect((await readdir(dir)).some(name => name.includes('.partial-'))).toBe(false)
    const previous = join(dir, 'keep.mp4')
    await writeFile(previous, 'previous valid export')
    await expect(renderClip({ source: { path: join(dir, 'missing.mp4') } as never, clip: {} as Clip,
      transcript: null, outputPath: previous })).rejects.toThrow()
    expect(await readFile(previous, 'utf8')).toBe('previous valid export')
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30000)
