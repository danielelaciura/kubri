import { getCacheStore } from "@/lib/cache/store";

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
  const store = getCacheStore();
  const cached = await store.get<T>(key);
  if (cached !== undefined) return cached;

  const result = await fetcher();
  await store.set(key, result, ttlMs);
  return result;
}

/** Invalidate all cache entries whose key starts with the given prefix. */
export async function invalidateCache(prefix: string): Promise<void> {
  await getCacheStore().deleteByPrefix(prefix);
}

/** Clear the entire cache. Primarily used in tests. */
export async function clearCache(): Promise<void> {
  await getCacheStore().clear();
}
