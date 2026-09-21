import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Clip, Composition } from '@shared/types'
import { validComposition } from '@shared/composition'
import { runAnalysisFfmpeg } from './ffmpeg'

interface Example {
  start: number
  end: number
  composition: Composition
  pixels?: Buffer
}

/** Cheap candidate retrieval, NOT layout verification. Dark screens and similar
 * slides can collide; every retrieved layout must pass a fresh rendered review. */
export function similarLayoutFrames(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== 48 * 27 * 3 || b.length !== a.length) return false
  let distance = 0, changed = 0
  for (let i = 0; i < a.length; i++) {
    const delta = Math.abs(a[i] - b[i])
    distance += delta
    if (delta > 32) changed++
  }
  return distance / (a.length * 255) < .025 && changed / a.length < .08
}

/** Small, source-scoped proposal memory. Rebuilt from saved checked clips on
 * demand; no global cache, model weights, GPU, or persistent image copies. */
export class LayoutMemory {
  private examples: Example[] = []

  constructor(private readonly videoPath: string, clips: Clip[] = []) {
    for (const clip of clips) this.remember(clip)
  }

  remember(clip: Clip): void {
    if (clip.reframeStatus !== 'done' || clip.reframeAnalysis?.version !== 2 ||
        clip.visualLayout?.kind !== 'screen' || clip.visualLayout.revision || clip.edit.aspect !== '9:16') return
    for (const shot of clip.visualLayout.shots ?? []) {
      if (shot.review?.status !== 'checked' || !validComposition(shot.composition) ||
          !shot.composition.layers.some(layer => layer.role === 'presenter') ||
          !Number.isFinite(shot.start) || !Number.isFinite(shot.end) || shot.end <= shot.start) continue
      this.examples.push({ start: shot.start, end: shot.end, composition: structuredClone(shot.composition) })
    }
    this.examples = this.examples.slice(-24)
  }

  async propose(start: number, end: number, signal?: AbortSignal): Promise<Composition | undefined> {
    signal?.throwIfAborted()
    const candidates = [...this.examples].sort((a, b) =>
      Math.abs(a.start + a.end - start - end) - Math.abs(b.start + b.end - start - end)).slice(0, 8)
    if (!candidates.length) return
    // Even exact source-time reuse is a proposal: the new narration can make
    // a different part of the same screen important.
    const covering = candidates.find(example => example.start <= start && example.end >= end)
    if (covering) return structuredClone(covering.composition)
    try {
      const current = await this.frame((start + end) / 2, signal)
      for (const example of candidates) {
        example.pixels ??= await this.frame((example.start + example.end) / 2, signal)
        if (similarLayoutFrames(current, example.pixels)) return structuredClone(example.composition)
      }
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn('Layout example lookup unavailable; using source analysis:', error)
    }
  }

  private async frame(time: number, signal?: AbortSignal): Promise<Buffer> {
    const directory = await mkdtemp(join(tmpdir(), 'cutawan-layout-example-'))
    try {
      const path = join(directory, 'frame.rgb')
      await runAnalysisFfmpeg(['-ss', time.toFixed(3), '-i', this.videoPath, '-frames:v', '1',
        '-vf', 'scale=48:27', '-pix_fmt', 'rgb24', '-f', 'rawvideo', path], { signal })
      return await readFile(path)
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
