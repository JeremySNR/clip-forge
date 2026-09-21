import { expect, it } from 'vitest'
import { cutsContentEdge } from '../src/main/pipeline/contentEdges'
const region = { x: .2, y: .2, width: .6, height: .6 }
function frame(x: number, y: number, width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(640 * 360).fill(20)
  for (let row = y; row < y + height; row++) pixels.fill(230, row * 640 + x, row * 640 + x + width)
  return pixels
}
it('vetoes a partly clipped title or axis but allows content with clearance', () => {
  expect(cutsContentEdge(frame(230, 67, 140, 12), region)).toBe(true)
  expect(cutsContentEdge(frame(230, 87, 140, 12), region)).toBe(false)
  expect(cutsContentEdge(frame(125, 120, 6, 100), region)).toBe(true)
  expect(cutsContentEdge(frame(135, 120, 6, 100), region)).toBe(false)
  expect(cutsContentEdge(new Uint8Array(), region)).toBe(true)
  expect(cutsContentEdge(frame(0, 0, 640, 5), { x: 0, y: 0, width: 1, height: 1 })).toBe(false)
})
