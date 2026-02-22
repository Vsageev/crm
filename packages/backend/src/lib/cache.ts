interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Simple in-memory cache with TTL.
 * Suitable for caching expensive report queries.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = store.get(key) as CacheEntry<T> | undefined;
  if (existing && Date.now() < existing.expiresAt) {
    return existing.data;
  }

  const data = await fn();
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

/**
 * Invalidate all cache entries matching a prefix.
 */
export function invalidateCache(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/**
 * Clear the entire cache.
 */
export function clearCache() {
  store.clear();
}
