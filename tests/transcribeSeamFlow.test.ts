import { readFileSync, existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Transcript } from '../src/shared/types'
import type { WhisperResponse } from '../src/main/pipeline/openai'
import { transcribeChunks } from '../src/main/pipeline/transcribe'
import { transcribeAudioFile } from '../src/main/pipeline/openai'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'

vi.mock('../src/main/pipeline/openai', () => ({transcribeAudioFile:vi.fn()}))
vi.mock('../src/main/pipeline/ffmpeg', () => ({runFfmpeg:vi.fn()}))
const fixture: {left:Transcript;right:Transcript;patch:Transcript} = JSON.parse(readFileSync(new URL('../benchmarks/public-corpus/transcript-seam-fixtures.json', import.meta.url),'utf8'))[0]
const response=(t:Transcript,offset:number,duration:number):WhisperResponse=>({
  language:'en',duration,text:t.segments.map(s=>s.text).join(' '),
  words:t.segments.flatMap(s=>s.words).map(w=>({word:w.text,start:w.start-offset,end:w.end-offset})),
  segments:t.segments.map(s=>({...s,start:s.start-offset,end:s.end-offset}))
})
const chunks=[{path:'left.mp3',offsetSec:0,keepFromSec:0,keepToSec:1196},{path:'right.mp3',offsetSec:1192,keepFromSec:1196,keepToSec:Infinity}]
afterEach(()=>vi.resetAllMocks())

describe('production seam repair flow',()=>{
  it('assembles contiguous audio, repairs the missing speech, and cleans temporary files',async()=>{
    vi.mocked(transcribeAudioFile)
      .mockResolvedValueOnce(response(fixture.left,0,1200))
      .mockResolvedValueOnce(response(fixture.right,1192,1200))
      .mockResolvedValueOnce(response(fixture.patch,1176,40))
    const progress=vi.fn()
    const result=await transcribeChunks('unused','whisper-1',chunks,'en',progress)
    expect(result.segments.flatMap(s=>s.words).map(w=>w.text.toLowerCase()).join(' ')).toContain('they saw our game performing well on steam')
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
    const args=vi.mocked(runFfmpeg).mock.calls[0][0]
    expect(args[args.indexOf('-filter_complex')+1]).toContain('atrim=start=1176:end=1196')
    expect(args[args.indexOf('-filter_complex')+1]).toContain('atrim=start=4:end=24')
    const repairCall=vi.mocked(transcribeAudioFile).mock.calls[2]
    expect(repairCall[3]).not.toHaveProperty('contextPrompt')
    expect(existsSync(repairCall[1])).toBe(false)
    const values=progress.mock.calls.map(([f])=>f)
    expect(values.at(-1)).toBe(1)
    expect(values).toEqual([...values].sort((a,b)=>a-b))
  })

  it('keeps the completed transcription when the optional audio repair request fails',async()=>{
    vi.spyOn(console,'warn').mockImplementation(()=>undefined)
    try {
      vi.mocked(transcribeAudioFile)
        .mockResolvedValueOnce(response(fixture.left,0,1200))
        .mockResolvedValueOnce(response(fixture.right,1192,1200))
        .mockRejectedValueOnce(new Error('Service unavailable'))
      const result=await transcribeChunks('unused','whisper-1',chunks,'en')
      expect(result.segments.length).toBeGreaterThan(0)
      expect(console.warn).toHaveBeenCalled()
    } finally { vi.restoreAllMocks() }
  })

  it('propagates cancellation during repair instead of checkpointing a partial result',async()=>{
    const controller=new AbortController()
    vi.mocked(transcribeAudioFile)
      .mockResolvedValueOnce(response(fixture.left,0,1200))
      .mockResolvedValueOnce(response(fixture.right,1192,1200))
      .mockImplementationOnce(async()=>{controller.abort();throw controller.signal.reason})
    await expect(transcribeChunks('unused','whisper-1',chunks,'en',undefined,controller.signal)).rejects.toMatchObject({name:'AbortError'})
  })
})
