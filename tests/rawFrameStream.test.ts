import { expect, it } from 'vitest'
import { streamRawFrames } from '../src/main/pipeline/ffmpeg'

const source = ['-f', 'lavfi', '-i', 'color=size=64x64:rate=25', '-pix_fmt', 'gray', '-f', 'rawvideo']

it('settles an unbounded decoder when the crop consumer fails', async () => {
  let frames = 0
  await expect(streamRawFrames(source, 64 * 64, async () => {
    if (++frames === 2) throw new Error('Crop store full')
  })).rejects.toThrow('Crop store full')
  expect(frames).toBe(2)
}, 5000)

it('settles an aborted frame stream without an unhandled child rejection', async () => {
  const controller = new AbortController()
  await expect(streamRawFrames(source, 64 * 64, () => {
    controller.abort()
    controller.signal.throwIfAborted()
  }, controller.signal)).rejects.toThrow(/abort/i)
}, 5000)
