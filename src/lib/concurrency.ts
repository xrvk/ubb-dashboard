/**
 * Run `mapper` over `items` with a bounded number of in-flight promises.
 *
 * Returns results in input order. Errors propagate the same way
 * `Promise.all` does (the first rejection rejects the whole batch);
 * callers that want per-item resilience should `.catch()` inside their
 * mapper and return a sentinel.
 *
 * Used for fan-out fetches that scale with N (e.g. one
 * `/usage/summary?cost_center_id=X` per cost center). At 1k CCs an
 * unbounded `Promise.all(items.map(...))` blows past GitHub's
 * secondary-rate-limit threshold; capping concurrency at ~8 avoids that
 * while still hiding ~all latency behind the cap.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, concurrency)
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor
      cursor += 1
      if (i >= items.length) return
      results[i] = await mapper(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}
