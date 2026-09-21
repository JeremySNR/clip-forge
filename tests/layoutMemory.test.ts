import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { Clip } from '@shared/types'
import { presenterComposition } from '@shared/composition'
import { LayoutMemory, similarLayoutFrames } from '../src/main/pipeline/layoutMemory'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'

const fixture = (): Clip => ({ reframeStatus: 'done', reframeAnalysis: { start: 0, end: 1, version: 2 },
  edit: { aspect: '9:16' }, visualLayout: { kind: 'screen', start: 0, end: 1,
    preserveContext: true, allowZoom: false, reason: 'screen', shots: [{ start: 0, end: 1, mode: 'fit',
      review: { status: 'checked', reason: 'Verified' }, composition: presenterComposition(
        { x: .2, y: .3, width: .6, height: .6 }, { x: .82, y: .02, width: .16, height: .26 }) }] }
}) as Clip

it('ignores pending, old, manual, rejected and camera examples', async () => {
  for (const change of [
    (c: Clip) => { c.reframeStatus = 'pending' },
    (c: Clip) => { c.reframeAnalysis!.version = 1 },
    (c: Clip) => { c.visualLayout!.revision = 1 },
    (c: Clip) => { c.visualLayout!.kind = 'camera' },
    (c: Clip) => { c.visualLayout!.shots![0].review!.status = 'needs-review' }
  ]) {
    const clip = fixture(); change(clip)
    expect(await new LayoutMemory('unused', [clip]).propose(.1, .9)).toBeUndefined()
  }
})

it('returns isolated geometry as a proposal, without a copied review or cumulative margins', async () => {
  const clip = fixture(), memory = new LayoutMemory('unused', [clip])
  const original = structuredClone(clip.visualLayout!.shots![0].composition)
  clip.visualLayout!.shots![0].composition!.layers[0].source.x = .9
  const proposal = (await memory.propose(.1, .9))!
  expect(proposal).toEqual(original)
  proposal.layers[0].source.x = .8
  expect(await memory.propose(.1, .9)).toEqual(original)
})

it('rejects malformed fingerprints and substantial visual changes', () => {
  const a = new Uint8Array(48 * 27 * 3).fill(100)
  expect(similarLayoutFrames(a, new Uint8Array(a.length).fill(102))).toBe(true)
  expect(similarLayoutFrames(a, new Uint8Array(a.length).fill(200))).toBe(false)
  expect(similarLayoutFrames(new Uint8Array(), new Uint8Array())).toBe(false)
  const b = a.slice(); b.fill(255, 0, b.length / 5)
  expect(similarLayoutFrames(a, b)).toBe(false)
})

it('retrieves a recurring screen using local pixels, but not a changed screen or cancelled request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-layout-memory-'))
  try {
    const path = join(dir, 'source.mp4')
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=5:d=4',
      '-vf', "drawbox=x=50:y=60:w=300:h=200:color=blue:t=fill,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='gte(t,3)'",
      '-c:v', 'mpeg4', path])
    const clip = fixture(), memory = new LayoutMemory(path, [clip])
    expect(await memory.propose(1.5, 2.5)).toEqual(clip.visualLayout!.shots![0].composition)
    expect(await memory.propose(3, 4)).toBeUndefined()
    const controller = new AbortController(); controller.abort()
    await expect(memory.propose(.1, .9, controller.signal)).rejects.toThrow()
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 15000)
