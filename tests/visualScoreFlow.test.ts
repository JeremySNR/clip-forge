import { describe, expect, it, vi } from 'vitest'
import { assessClipVisuals, plannedClipTranscriptText } from '../src/main/pipeline/visualScore'
import { chatJSON } from '../src/main/pipeline/openai'
import type { Clip, Transcript } from '../src/shared/types'
vi.mock('../src/main/pipeline/openai',()=>({chatJSON:vi.fn()}))
vi.mock('../src/main/pipeline/ffmpeg',()=>({runFfmpeg:vi.fn()}))
vi.mock('node:fs/promises',()=>({readFile:async()=>Buffer.from('test image'),mkdir:vi.fn().mockResolvedValue(undefined),rm:vi.fn().mockResolvedValue(undefined)}))
const transcript:Transcript={language:'en',durationSec:12,segments:[{id:0,start:0,end:12,text:'',words:[
 {text:'We',start:0,end:.2},{text:'found',start:.3,end:.5},{text:'it.',start:.6,end:1},
 {text:'um',start:5,end:5.2},{text:'Here',start:10,end:10.2},{text:'it',start:10.3,end:10.5},{text:'is.',start:10.6,end:11}
]}]}
const clip={title:'SECRET TITLE',hook:'SECRET HOOK',viralityScore:99,edit:{start:0,end:12,tightenCuts:true}} as Clip

describe('actual-content visual review',()=>{
 it('shows retained speech and source frames without generated titles, hooks or prior scores',async()=>{
  vi.mocked(chatJSON).mockResolvedValue({visual_score:70,visual_summary:'Complete',preserve_context:false,allow_zoom:false,layout_reason:'Headroom',needs_visual_payoff:false,story_issue:{kind:'none',evidence_quote:'',reason:''}})
  await assessClipVisuals('key','model','source.mp4',transcript,clip)
  const messages=vi.mocked(chatJSON).mock.calls[0][2]
  const request=JSON.stringify(messages)
  expect(request).not.toContain('SECRET TITLE')
  expect(request).not.toContain('SECRET HOOK')
  expect(request).toContain('We found it. Here it is.')
  expect(request).not.toContain('it. um Here')
  const content=messages[1].content
  expect(Array.isArray(content) ? content.filter(part=>part.type==='image_url') : []).toHaveLength(6)
 })
 it('uses full selected speech when tightening is disabled and preserves protected visual-interval speech',()=>{
  expect(plannedClipTranscriptText({...clip,edit:{...clip.edit,tightenCuts:false}},transcript)).toContain('um')
  expect(plannedClipTranscriptText({...clip,visualStory:{protectedRanges:[{start:4,end:6}],reason:'Action'}},transcript)).toContain('um')
 })
})
