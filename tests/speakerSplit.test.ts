import { describe, expect, it } from 'vitest'
import { planSpeakerSplits, speakerPanelSource } from '../src/main/pipeline/speakerSplit'
import type { ScoredFaceTrack } from '../src/main/pipeline/asd'
import { applySpeakerSplits, automaticLayoutShots, layoutBlocksAutoZoom, validLayoutShots } from '@shared/contentType'
import { validComposition } from '@shared/composition'
import type { Clip } from '@shared/types'

const FPS = 25
const SOURCE = { width: 1920, height: 1080 }

/** A seated face at `x` that speaks whenever `talking(second)` is true. */
function person(x: number, frames: number, talking: (second: number) => boolean): ScoredFaceTrack {
  const box = { x1: x - 0.04, y1: 0.3, x2: x + 0.04, y2: 0.44, score: 1 }
  return {
    start: 0,
    centres: Array(frames).fill(x),
    areas: Array(frames).fill(0.0112),
    scores: Array.from({ length: frames }, (_, f) => (talking(f / FPS) ? 2 : -2)),
    boxes: Array(frames).fill(box)
  }
}

describe('planSpeakerSplits', () => {
  it('splits a quick back-and-forth between two people in one shot', () => {
    const frames = 20 * FPS
    // Alternate every 1.5 s.
    const left = person(0.3, frames, s => Math.floor(s / 1.5) % 2 === 0)
    const right = person(0.7, frames, s => Math.floor(s / 1.5) % 2 === 1)
    const splits = planSpeakerSplits([left, right], frames, [], FPS, 100, SOURCE)
    expect(splits).toHaveLength(1)
    expect(splits[0].start).toBeCloseTo(100, 0)
    expect(splits[0].end).toBeCloseTo(120, 0)
    const composition = splits[0].composition
    expect(validComposition(composition)).toBe(true)
    // Left person on top; neither panel reaches the other face.
    const [top, bottom] = composition.layers.map(l => l.source)
    expect(top.x + top.width).toBeLessThan(0.66)
    expect(bottom.x).toBeGreaterThan(0.34)
  })

  it('keeps the speaker crop for a monologue with an occasional "yeah"', () => {
    const frames = 20 * FPS
    const talker = person(0.3, frames, () => true)
    const listener = person(0.7, frames, s => s > 10 && s < 10.4)
    expect(planSpeakerSplits([talker, listener], frames, [], FPS, 0, SOURCE)).toEqual([])
  })

  it('never splits across a camera cut or with one face on screen', () => {
    const frames = 20 * FPS
    const left = person(0.3, frames, s => Math.floor(s / 1.5) % 2 === 0)
    const right = person(0.7, frames, s => Math.floor(s / 1.5) % 2 === 1)
    const splits = planSpeakerSplits([left, right], frames, [10 * FPS], FPS, 0, SOURCE)
    expect(splits.every(s => s.end <= 10.001 || s.start >= 9.999)).toBe(true)
    expect(planSpeakerSplits([left], frames, [], FPS, 0, SOURCE)).toEqual([])
  })

  it('skips a panel that would need a heavy blow-up to exclude a close neighbour', () => {
    const box = { x1: 0.49, y1: 0.4, x2: 0.51, y2: 0.43, score: 1 }
    expect(speakerPanelSource(box, { width: 1280, height: 720 }, 0.05)).toBeUndefined()
  })
})

describe('applySpeakerSplits', () => {
  const clip = (splitsOn = true): Clip => {
    const frames = 20 * FPS
    const left = person(0.3, frames, s => Math.floor(s / 1.5) % 2 === 0)
    const right = person(0.7, frames, s => Math.floor(s / 1.5) % 2 === 1)
    const splits = planSpeakerSplits([left, right], frames, [], FPS, 5, SOURCE)
      .map(s => ({ ...s, start: 8, end: 14 }))
    return { edit: { start: 0, end: 25, framing: 'auto', reframeMode: 'crop', aspect: '9:16', speakerSplit: splitsOn },
      visualLayout: applySpeakerSplits(undefined, 0, 25, splits) } as unknown as Clip
  }

  it('tiles the clip with speaker crops around the split', () => {
    const layout = clip().visualLayout!
    expect(validLayoutShots(layout, 0, 25)).toBe(true)
    expect(layout.shots!.map(s => [s.start, s.end, s.mode])).toEqual([[0, 8, 'crop'], [8, 14, 'fit'], [14, 25, 'crop']])
    expect(layoutBlocksAutoZoom(clip())).toBe(true)
  })

  it('turns the split back into a crop when switched off in the editor', () => {
    expect(automaticLayoutShots(clip(false)).every(s => s.mode === 'crop' && !s.composition)).toBe(true)
    expect(layoutBlocksAutoZoom(clip(false))).toBe(false)
  })

  it('leaves inspected screen layouts alone', () => {
    const screen = { start: 0, end: 25, preserveContext: true, allowZoom: false, reason: 'slides', kind: 'screen' as const }
    expect(applySpeakerSplits(screen, 0, 25, [])).toBe(screen)
    const splits = clip().visualLayout!.shots!.filter(s => s.composition).map(s => ({ start: s.start, end: s.end, composition: s.composition }))
    expect(applySpeakerSplits(screen, 0, 25, splits)).toBe(screen)
  })
})
