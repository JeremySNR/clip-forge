import { expect, it } from 'vitest'
import { decodeYuNet, faceDetectionSize, yunetInput } from '../src/main/pipeline/yunet'

it('keeps source geometry and avoids upscaling small sources', () => {
  expect(faceDetectionSize(1920, 1080)).toEqual({ width: 1280, height: 720 })
  expect(faceDetectionSize(640, 480)).toEqual({ width: 640, height: 480 })
  expect(faceDetectionSize(2160, 3840)).toEqual({ width: 720, height: 1280 })
})

it('uses unnormalized BGR and pads the bottom and right, without stretching', () => {
  const input = yunetInput(Buffer.from([255, 127, 0]), 1, 1)
  expect([input.width, input.height]).toEqual([32, 32])
  expect([input.data[0], input.data[1024], input.data[2048]]).toEqual([0, 127, 255])
  expect(input.data[1]).toBe(0)
  expect(() => yunetInput(Buffer.alloc(2), 1, 1)).toThrow('Invalid')
})

it('decodes the grid offsets, exponential sizes and combined object/class score', () => {
  const heads: Record<string, Float32Array> = {}
  for (const stride of [8, 16, 32]) {
    const length = (64 / stride) * (32 / stride)
    heads[`cls_${stride}`] = new Float32Array(length)
    heads[`obj_${stride}`] = new Float32Array(length)
    heads[`bbox_${stride}`] = new Float32Array(length * 4)
  }
  heads.cls_8[10] = heads.obj_8[10] = .81
  heads.bbox_8.set([.5, .5, Math.log(2), 0], 40)
  const [box] = decodeYuNet(heads, 64, 64, 32)
  expect(box.x1).toBeCloseTo(12 / 64)
  expect(box.y1).toBeCloseTo(8 / 32)
  expect(box.x2).toBeCloseTo(28 / 64)
  expect(box.y2).toBeCloseTo(16 / 32)
  expect(box.score).toBeCloseTo(.81)
  expect(decodeYuNet(heads, 64, 64, 32, .9)).toEqual([])
})
