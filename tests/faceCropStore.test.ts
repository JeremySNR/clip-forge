import { expect, it } from 'vitest'
import { FaceCropStore } from '../src/main/pipeline/faceCropStore'
import { frontendWindows } from '../src/main/pipeline/asdFrontend'

it.each([0, 1024 ** 3])('preserves overlapping inference windows in disk/memory mode (%s)', async budget => {
  const store = await FaceCropStore.create([80, 1], budget)
  try {
    for (let i = 0; i < 80; i++) await store.push(0, new Uint8Array(112 * 112).fill(i))
    await store.push(1, new Uint8Array(112 * 112).fill(123))
    await store.finish(0)
    await store.read(0, async crops => {
      expect(crops.length).toBe(80)
      for (const window of frontendWindows(80)) {
        const data = await crops.slice(window.inputFrom, window.inputTo)
        expect(data.map(frame => frame[0])).toEqual(Array.from({ length: data.length }, (_, i) => window.inputFrom + i))
        expect(data.every(frame => frame.length === 112 * 112)).toBe(true)
      }
    })
    await store.read(1, async crops => expect((await crops.slice(0, 1))[0][100]).toBe(123))
  } finally { await store.close() }
})
