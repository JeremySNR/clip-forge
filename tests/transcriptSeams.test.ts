import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Transcript } from '../src/shared/types'
import { needsSeamRepair, repairTranscriptSeam } from '../src/main/pipeline/transcriptSeams'

interface Fixture { source: string; seam: number; left: Transcript; right: Transcript; before: Transcript; patch: Transcript }
const fixtures: Fixture[] = JSON.parse(readFileSync(new URL('../benchmarks/public-corpus/transcript-seam-fixtures.json', import.meta.url), 'utf8'))
const text = (t: Transcript): string => t.segments.flatMap(s => s.words).map(w => w.text.toLowerCase()).join(' ')

describe('audio-anchored transcription join repair', () => {
  for (const [index, phrase] of [[0, 'they saw our game performing well on steam'], [1, 'back then it worked, and we realized'], [3, 'because our time is over, sorry.']] as const) {
    it(`recovers the missing phrase at ${fixtures[index].source} ${fixtures[index].seam}s`, () => {
      const f = fixtures[index], saved = structuredClone(f.before)
      expect(needsSeamRepair(f.left, f.right, f.seam)).toBe(true)
      expect(text(f.before)).not.toContain(phrase)
      const result = repairTranscriptSeam(f.before, f.patch, f.seam)
      expect(result.applied).toBe(true)
      expect(text(result.transcript)).toContain(phrase)
      expect(f.before).toEqual(saved)
      const outside = (t:Transcript) => t.segments.flatMap(s=>s.words).filter(w=>w.end<=result.from! || w.start>=result.to!)
      expect(outside(result.transcript)).toEqual(outside(f.before))
      const words = result.transcript.segments.flatMap(s=>s.words)
      expect(words.every((w,i)=>w.end>w.start && (!i || w.start>=words[i-1].end-1e-8))).toBe(true)
    })
  }

  it('leaves the coherent graph introduction alone despite minor decoder differences', () => {
    const f = fixtures[2]
    expect(needsSeamRepair(f.left,f.right,f.seam)).toBe(false)
  })

  it('requires matching anchors on both sides and preserves the input when timing is unreliable', () => {
    const f=fixtures[0], patch=structuredClone(f.patch)
    for(const s of patch.segments) for(const w of s.words) { w.start+=3; w.end+=3 }
    const result=repairTranscriptSeam(f.before,patch,f.seam)
    expect(result.applied).toBe(false)
    expect(result.transcript).toBe(f.before)
  })

  it('rejects an empty patch and malformed timestamps without deleting any original speech', () => {
    const f=fixtures[0]
    expect(repairTranscriptSeam(f.before,{...f.patch,segments:[]},f.seam).transcript).toBe(f.before)
    const patch=structuredClone(f.patch)
    patch.segments[0].words[0].end=NaN
    expect(repairTranscriptSeam(f.before,patch,f.seam).applied).toBe(false)
  })
})
