import { LRUCache } from "lru-cache";

/** Wrapper to store any value in the LRU cache (which requires V extends {}). */
interface CacheEntry {
  value: NonNullable<object> | string | number | boolean;
}

const cache = new LRUCache<string, CacheEntry>({
  max: 1000,
});

/** Default TTL for candidate list queries (60s). */
export const LIST_TTL_MS = 60_000;

/** Default TTL for single candidate record queries (30s). */
export const RECORD_TTL_MS = 30_000;

/**
 * Fetch data with caching. If the key exists in cache and has not expired,
 * the cached value is returned. Otherwise, the fetcher is called and the
 * result is stored in cache.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached.value as T;
  }

  const result = await fetcher();
  cache.set(key, { value: result as CacheEntry["value"] }, { ttl: ttlMs });
  return result;
}

/**
 * Invalidate all cache entries whose key starts with the given pattern.
 */
export function invalidateCache(pattern: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(pattern)) {
      cache.delete(key);
    }
  }
}

/**
 * Clear the entire cache. Primarily used in tests.
 */
export function clearCache(): void {
  cache.clear();
}
