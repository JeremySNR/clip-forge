import { describe, expect, it } from 'vitest'
import { chooseSpeakerByScores, refineSpeakerSwitches, type SpeakerCandidate } from '../src/main/pipeline/speaker'

const FPS = 25
const sec = (s: number): number => Math.round(s * FPS)

/** A face visible for the whole clip that speaks during the given second ranges. */
function track(centre: number, frames: number, speaking: Array<[number, number]>): SpeakerCandidate {
  return {
    start: 0,
    centres: new Array(frames).fill(centre),
    areas: new Array(frames).fill(0.05),
    scores: Array.from({ length: frames }, (_, f) => speaking.some(([a, b]) => f >= sec(a) && f < sec(b)) ? 3 : -3)
  }
}

function select(tracks: SpeakerCandidate[], frames: number, cuts: number[] = []): ReturnType<typeof refineSpeakerSwitches> {
  return refineSpeakerSwitches(chooseSpeakerByScores(tracks, frames, cuts, FPS), tracks, cuts, FPS)
}

describe('offline speaker switch refinement', () => {
  it('cuts to the new speaker slightly before they start, not after confirming them', () => {
    const frames = sec(10)
    const tracks = [track(0.25, frames, [[0, 5]]), track(0.75, frames, [[5, 10]])]
    const reactive = chooseSpeakerByScores(tracks, frames, [], FPS)
    expect(reactive.switchCuts[0]).toBeGreaterThanOrEqual(sec(5.3))
    const refined = select(tracks, frames)
    expect(refined.switchCuts).toEqual([sec(5) - sec(0.15)])
    expect(refined.centres[sec(4.9)]).toBe(0.75)
    expect(refined.centres[sec(4.7)]).toBe(0.25)
  })

  it('stays on the main speaker through a brief backchannel', () => {
    const frames = sec(12)
    // B says "yeah, right" for 0.9 s while A talks either side.
    const tracks = [track(0.25, frames, [[0, 5], [6, 12]]), track(0.75, frames, [[5, 5.9]])]
    const refined = select(tracks, frames)
    expect(refined.switchCuts).toEqual([])
    expect(refined.centres.every(c => c === 0.25)).toBe(true)
  })

  it('keeps real turns and never moves a cut across a camera cut', () => {
    const frames = sec(12)
    const tracks = [track(0.25, frames, [[0, 4], [8, 12]]), track(0.75, frames, [[4, 8]])]
    const turns = select(tracks, frames)
    expect(turns.switchCuts).toHaveLength(2)
    // A camera cut at 3.9 s: the switch to B may not start before it.
    const cut = select(tracks, frames, [sec(3.9)])
    expect(cut.switchCuts.every(f => f > sec(3.9))).toBe(true)
    expect(cut.centres[sec(3.8)]).toBe(0.25)
  })

  it('passes selections without speaker identities through unchanged', () => {
    const selection = { centres: [0.5, 0.5], switchCuts: [] }
    expect(refineSpeakerSwitches(selection, [], [], FPS)).toBe(selection)
  })
})
