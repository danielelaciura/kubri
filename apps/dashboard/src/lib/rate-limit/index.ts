import { Redis } from "@upstash/redis";

/** Counter store: Upstash in production, in-memory in dev/test. */
export interface Counter {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface RateLimitRule {
  /** Caller-chosen key, e.g. "landing:ip:<hash>:h". Never raw personal data. */
  key: string;
  limit: number;
  windowSec: number;
}

/** The limiter cannot decide: public endpoints must refuse (fail closed). */
export class RateLimitUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("rate limiter unavailable", { cause });
    this.name = "RateLimitUnavailableError";
  }
}

class MemoryCounter implements Counter {
  private counts = new Map<string, number>();
  async incr(key: string): Promise<number> {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n;
  }
  async expire(): Promise<number> {
    return 1;
  }
}

let counter: Counter | null | undefined;

/** Null in production without Upstash credentials: callers fail closed. */
function getCounter(): Counter | null {
  if (counter !== undefined) return counter;
  const url = process.env["UPSTASH_REDIS_REST_URL"];
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (url && token) counter = new Redis({ url, token, retry: { retries: 1, backoff: () => 200 } });
  else counter = process.env["NODE_ENV"] === "production" ? null : new MemoryCounter();
  return counter;
}

/**
 * Count one hit against each rule (fixed windows) and report whether all are
 * within their limit. Rules are checked in order; later rules are not counted
 * once one refuses, so put the narrowest (per-IP / per-import) rules first.
 * Throws RateLimitUnavailableError when no counter is configured in production
 * or the store errors; throws Error on invalid rules.
 */
export async function consumeRateLimits(rules: RateLimitRule[], now = Date.now()): Promise<boolean> {
  if (rules.length === 0) throw new Error("consumeRateLimits: no rules");
  for (const r of rules) {
    if (!Number.isInteger(r.windowSec) || r.windowSec <= 0 || !Number.isInteger(r.limit) || r.limit < 0) {
      throw new Error("consumeRateLimits: invalid rule");
    }
  }
  const store = getCounter();
  if (!store) throw new RateLimitUnavailableError();
  try {
    for (const rule of rules) {
      const windowIndex = Math.floor(now / (rule.windowSec * 1000));
      const key = `rl:${rule.key}:${windowIndex}`;
      const count = await store.incr(key);
      if (count === 1) await store.expire(key, rule.windowSec);
      if (count > rule.limit) return false;
    }
    return true;
  } catch (e) {
    throw new RateLimitUnavailableError(e);
  }
}

/** Test-only: inject a counter, or `undefined` to re-read the environment. */
export function _setCounterForTests(c: Counter | undefined): void {
  counter = c;
}
