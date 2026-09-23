import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyClipStyle, classifySample, hasDivider, liveInset, type StyleFace, type StyleSample } from '../src/shared/shotStyle'
import { pointSampledLuma, triageClipStyle, triageTimes } from '../src/main/pipeline/shotTriage'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'

const W = 320, H = 180

/** Deterministic pseudo-random noise, so fixtures are stable across runs. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

type Painter = (x: number, y: number) => 'still' | 'live'

/** Build a frame pair: still pixels repeat exactly, live pixels carry camera-like noise. */
function sample(paint: Painter, faces: StyleFace[] = [], seed = 1): StyleSample {
  const random = rng(seed)
  const a = new Uint8Array(W * H), b = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      // Still UI: flat panels with hard-edged "text" strokes.
      const base = (x % 40 < 2 || y % 24 < 2) ? 30 : 220
      if (paint(x, y) === 'still') { a[i] = b[i] = base } else {
        const level = 90 + ((x + y) >> 3) % 40
        a[i] = level + Math.floor(random() * 9)
        b[i] = level + Math.floor(random() * 9)
      }
    }
  }
  return { width: W, height: H, a, b, faces }
}

const face = (cx: number, cy: number, h: number): StyleFace =>
  ({ x1: cx - h * 0.3, y1: cy - h / 2, x2: cx + h * 0.3, y2: cy + h / 2, score: 0.9 })

/** A webcam inset in the lower right of a still screen. */
const insetPainter: Painter = (x, y) => (x >= 240 && y >= 120 ? 'live' : 'still')

describe('shot style triage', () => {
  it('finds a webcam inset wherever it sits and recommends content + presenter', () => {
    const inset = liveInset(sample(insetPainter))!
    expect(inset.x).toBeCloseTo(0.75, 1)
    expect(inset.y).toBeCloseTo(0.67, 1)
    expect(inset.x + inset.width).toBeGreaterThan(0.95)
    const topLeft = liveInset(sample((x, y) => (x < 80 && y < 60 ? 'live' : 'still')))!
    expect(topLeft.x).toBe(0)
    expect(topLeft.y).toBe(0)

    const clip = classifyClipStyle([1, 2, 3].map(seed => sample(insetPainter, [face(0.87, 0.83, 0.2)], seed)))
    expect(clip.style).toBe('screen-with-presenter')
    expect(clip.recommendation).toBe('content-with-presenter')
    expect(clip.confidence).toBe(1)
    expect(clip.inset!.x).toBeCloseTo(0.75, 1)
  })

  it('treats a still screen without a live face panel as screen content', () => {
    // A photo of a face inside a slide is not a presenter.
    expect(classifySample(sample(() => 'still', [face(0.5, 0.4, 0.2)])).style).toBe('screen')
    // A live region (playing video, scrolling) without a face is not one either.
    expect(classifySample(sample(insetPainter)).style).toBe('screen')
    expect(classifyClipStyle([sample(() => 'still')]).recommendation).toBe('content-fit')
  })

  it('separates single speakers, two-shots and small-faced groups in camera footage', () => {
    const live: Painter = () => 'live'
    expect(classifySample(sample(live, [face(0.5, 0.35, 0.3)])).style).toBe('single-speaker')
    // Small background figures do not make a lone speaker a group.
    expect(classifySample(sample(live, [face(0.5, 0.35, 0.3), face(0.9, 0.5, 0.06)])).style).toBe('single-speaker')
    expect(classifySample(sample(live, [face(0.3, 0.4, 0.2), face(0.7, 0.4, 0.18)])).style).toBe('two-shot')
    const group = classifyClipStyle([sample(live, [face(0.2, 0.5, 0.06), face(0.5, 0.5, 0.07), face(0.8, 0.5, 0.06)])])
    expect(group.style).toBe('group')
    expect(group.smallFaces).toBe(true)
    expect(group.recommendation).toBe('wide-fit')
    expect(classifyClipStyle([sample(live, [face(0.5, 0.35, 0.3)])]).recommendation).toBe('speaker-crop')
    expect(classifySample(sample(live)).style).toBe('no-face')
  })

  it('recognises remote-call tiles by the still divider between faces', () => {
    const tiles: Painter = (x) => (x >= 158 && x <= 161 ? 'still' : 'live')
    const faces = [face(0.25, 0.4, 0.25), face(0.75, 0.4, 0.25)]
    expect(hasDivider(sample(tiles), 'x', 0.35, 0.65)).toBe(true)
    // Ordinary camera noise never forms a divider, even between two faces.
    expect(hasDivider(sample(() => 'live'), 'x', 0.35, 0.65)).toBe(false)
    const clip = classifyClipStyle([sample(tiles, faces)])
    expect(clip.style).toBe('gallery')
    expect(clip.recommendation).toBe('gallery-tiles')
    // A 2x2 grid: faces stacked in one column are separated by a horizontal gutter.
    const grid: Painter = (x, y) => ((x >= 158 && x <= 161) || (y >= 88 && y <= 91) ? 'still' : 'live')
    expect(classifySample(sample(grid, [face(0.25, 0.25, 0.2), face(0.25, 0.75, 0.2),
      face(0.75, 0.25, 0.2), face(0.75, 0.75, 0.2)])).style).toBe('gallery')
  })

  it('reports disagreement as mixed with a safe recommendation', () => {
    const live: Painter = () => 'live'
    const clip = classifyClipStyle([
      sample(live, [face(0.5, 0.35, 0.3)]), sample(() => 'still'), sample(insetPainter, [face(0.87, 0.83, 0.2)])
    ])
    expect(clip.style).toBe('mixed')
    expect(clip.recommendation).toBe('wide-fit')
    expect(classifyClipStyle([]).confidence).toBe(0)
  })

  it('point-samples luma so per-pixel noise survives downscaling', () => {
    const rgb = Buffer.alloc(8 * 4 * 3)
    for (let i = 0; i < 8 * 4; i++) rgb.fill(i % 2 ? 200 : 10, i * 3, i * 3 + 3)
    const luma = pointSampledLuma(rgb, 8, 4, 4)
    expect(luma.width).toBe(4)
    expect([...luma.data].every(v => v === 9 || v === 10)).toBe(true)
    expect(triageTimes(10, 20, 4).every(t => t > 10 && t < 20)).toBe(true)
  })

  it('distinguishes decoded still screens from noisy camera footage end to end', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cutawan-triage-'))
    try {
      const screen = join(dir, 'screen.mp4'), camera = join(dir, 'camera.mp4')
      await runFfmpeg(['-f', 'lavfi', '-i', 'smptebars=s=640x360:r=25:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', screen])
      await runFfmpeg(['-f', 'lavfi', '-i', 'smptebars=s=640x360:r=25:d=3', '-vf', 'noise=alls=12:allf=t',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', camera])
      const still = await triageClipStyle(screen, 0, 3)
      expect(still.style).toBe('screen')
      expect(still.samples.length).toBe(6)
      expect((await triageClipStyle(camera, 0, 3)).style).toBe('no-face')
      // An encoded live inset over a still screen is located from the pixels.
      const pip = join(dir, 'pip.mp4')
      await runFfmpeg(['-f', 'lavfi', '-i', 'smptebars=s=640x360:r=25:d=3', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=25:d=3',
        '-filter_complex', '[1:v]noise=alls=12:allf=t[cam];[0:v][cam]overlay=460:250', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', pip])
      const inset = (await triageClipStyle(pip, 0, 3)).samples[0].inset!
      expect(inset.x).toBeCloseTo(460 / 640, 1)
      expect(inset.y).toBeCloseTo(250 / 360, 1)
      expect(inset.width).toBeCloseTo(160 / 640, 1)
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 60000)
})
