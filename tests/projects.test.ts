import { describe, expect, it } from 'vitest'
import { withProjectLock } from '../src/main/projects'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('withProjectLock', () => {
  it('serialises writers on the same project id', async () => {
    const order: string[] = []
    const first = withProjectLock('a', async () => {
      order.push('first-start')
      await sleep(30)
      order.push('first-end')
    })
    const second = withProjectLock('a', async () => {
      order.push('second')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  it('does not block writers on other project ids', async () => {
    const order: string[] = []
    const slow = withProjectLock('a', async () => {
      await sleep(30)
      order.push('a')
    })
    const fast = withProjectLock('b', async () => {
      order.push('b')
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(['b', 'a'])
  })

  it('releases the lock after a failure and propagates the error', async () => {
    const failing = withProjectLock('a', async () => {
      throw new Error('boom')
    })
    await expect(failing).rejects.toThrow('boom')
    // The queue must keep moving after a failed writer.
    const after = await withProjectLock('a', async () => 'ok')
    expect(after).toBe('ok')
  })

  it('returns each writer its own result', async () => {
    const [x, y] = await Promise.all([
      withProjectLock('a', async () => 1),
      withProjectLock('a', async () => 2)
    ])
    expect(x).toBe(1)
    expect(y).toBe(2)
  })
})
