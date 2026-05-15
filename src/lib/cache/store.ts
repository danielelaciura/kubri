import { Redis } from "@upstash/redis";
import { LRUCache } from "lru-cache";

/**
 * Unified cache abstraction. Backed by Upstash Redis when
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set, otherwise
 * falls back to an in-process LRU (suitable for local dev and tests).
 *
 * On Vercel the in-memory fallback is effectively a no-op cache because
 * each serverless invocation starts cold — production MUST configure
 * Upstash credentials.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
  clear(): Promise<void>;
}

interface Envelope {
  v: unknown;
}

class InMemoryStore implements CacheStore {
  private lru = new LRUCache<string, Envelope>({ max: 2000 });

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.lru.get(key);
    return entry === undefined ? undefined : (entry.v as T);
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.lru.set(key, { v: value }, { ttl: ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.lru.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    for (const k of this.lru.keys()) {
      if (k.startsWith(prefix)) this.lru.delete(k);
    }
  }

  async clear(): Promise<void> {
    this.lru.clear();
  }
}

class UpstashStore implements CacheStore {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const v = await this.redis.get<T>(key);
      return v ?? undefined;
    } catch (e) {
      console.error("[cache] upstash GET failed", { key, error: errMsg(e) });
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      await this.redis.set(key, value, { px: ttlMs });
    } catch (e) {
      console.error("[cache] upstash SET failed", { key, error: errMsg(e) });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (e) {
      console.error("[cache] upstash DEL failed", { key, error: errMsg(e) });
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    try {
      let cursor: string | number = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const [next, keys]: [string | number, string[]] = await this.redis.scan(
          cursor,
          { match: `${prefix}*`, count: 200 },
        );
        if (keys.length > 0) {
          await this.redis.del(...(keys as [string, ...string[]]));
        }
        cursor = typeof next === "string" ? Number(next) : next;
        if (cursor === 0) break;
      }
    } catch (e) {
      console.error("[cache] upstash SCAN/DEL failed", {
        prefix,
        error: errMsg(e),
      });
    }
  }

  async clear(): Promise<void> {
    try {
      await this.redis.flushdb();
    } catch (e) {
      console.error("[cache] upstash FLUSHDB failed", { error: errMsg(e) });
    }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

let cachedStore: CacheStore | null = null;

function buildStore(): CacheStore {
  const url = process.env["UPSTASH_REDIS_REST_URL"];
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (url && token) {
    return new UpstashStore(new Redis({ url, token }));
  }
  if (process.env["NODE_ENV"] === "production") {
    console.warn(
      "[cache] Upstash credentials missing — falling back to in-memory cache. On serverless this means effectively no cache across requests.",
    );
  }
  return new InMemoryStore();
}

export function getCacheStore(): CacheStore {
  cachedStore ??= buildStore();
  return cachedStore;
}

/** Test-only: reset the singleton (so a new env can take effect). */
export function _resetCacheStoreForTests(): void {
  cachedStore = null;
}
