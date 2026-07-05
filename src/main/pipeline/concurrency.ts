/** Run `fn` over items with bounded concurrency, preserving order. */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      await fn(items[index], index)
    }
  })
  await Promise.all(workers)
}
