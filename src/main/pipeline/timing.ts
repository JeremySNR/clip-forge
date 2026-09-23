/**
 * Wall-clock stage timings, logged as `[timing]` lines so a real run shows
 * where processing time goes. Nested labels use `/` (e.g. `asd/crops`).
 */

export interface StageTiming { stage: string; seconds: number }

type Listener = (timing: StageTiming) => void
const listeners = new Set<Listener>()

/** Observe completed stages (benchmarks and tests); returns an unsubscribe. */
export function onStageTiming(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Run `fn`, then record how long it took, including when it throws. */
export async function timed<T>(stage: string, fn: () => Promise<T>, detail?: Record<string, unknown>): Promise<T> {
  const started = performance.now()
  try {
    return await fn()
  } finally {
    const seconds = Math.round((performance.now() - started) / 10) / 100
    console.info('[timing]', JSON.stringify({ stage, ...detail, seconds }))
    for (const listener of listeners) listener({ stage, seconds })
  }
}
