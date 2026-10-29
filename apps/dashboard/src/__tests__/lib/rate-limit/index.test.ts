import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  consumeRateLimits,
  RateLimitUnavailableError,
  _setCounterForTests,
  type Counter,
} from "@/lib/rate-limit";

function memoryCounter(): Counter & { store: Map<string, number> } {
  const store = new Map<string, number>();
  return {
    store,
    incr: vi.fn(async (k: string) => {
      const n = (store.get(k) ?? 0) + 1;
      store.set(k, n);
      return n;
    }),
    expire: vi.fn(async () => 1),
  };
}

describe("consumeRateLimits", () => {
  const NOW = new Date("2026-10-29T10:15:00Z").getTime();
  afterEach(() => _setCounterForTests(undefined));

  it("allows up to the limit within a window, then refuses", async () => {
    const c = memoryCounter();
    _setCounterForTests(c);
    const rule = { key: "ip:abc", limit: 2, windowSec: 3600 };
    await expect(consumeRateLimits([rule], NOW)).resolves.toBe(true);
    await expect(consumeRateLimits([rule], NOW)).resolves.toBe(true);
    await expect(consumeRateLimits([rule], NOW)).resolves.toBe(false);
  });

  it("starts a fresh count in the next window and sets a TTL", async () => {
    const c = memoryCounter();
    _setCounterForTests(c);
    const rule = { key: "ip:abc", limit: 1, windowSec: 3600 };
    await consumeRateLimits([rule], NOW);
    await expect(consumeRateLimits([rule], NOW + 3600 * 1000)).resolves.toBe(true);
    expect(c.expire).toHaveBeenCalledWith(expect.stringMatching(/^rl:ip:abc:\d+$/), 3600);
  });

  it("refuses when any rule is exceeded", async () => {
    _setCounterForTests(memoryCounter());
    const tight = { key: "a", limit: 0, windowSec: 60 };
    const loose = { key: "b", limit: 10, windowSec: 60 };
    await expect(consumeRateLimits([loose, tight], NOW)).resolves.toBe(false);
  });

  it("stops at the first refusal without counting later rules", async () => {
    const c = memoryCounter();
    _setCounterForTests(c);
    const tight = { key: "tight", limit: 0, windowSec: 60 };
    const loose = { key: "loose", limit: 10, windowSec: 60 };
    await expect(consumeRateLimits([tight, loose], NOW)).resolves.toBe(false);
    expect([...c.store.keys()].some((k) => k.startsWith("rl:loose"))).toBe(false);
  });

  it("increments every rule when all pass", async () => {
    const c = memoryCounter();
    _setCounterForTests(c);
    await consumeRateLimits(
      [
        { key: "a", limit: 5, windowSec: 60 },
        { key: "b", limit: 5, windowSec: 60 },
      ],
      NOW,
    );
    expect(c.store.size).toBe(2);
  });

  it("sets the TTL only on the first hit of a window", async () => {
    const c = memoryCounter();
    _setCounterForTests(c);
    const rule = { key: "ttl", limit: 5, windowSec: 60 };
    await consumeRateLimits([rule], NOW);
    await consumeRateLimits([rule], NOW);
    expect(c.expire).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid rules", async () => {
    _setCounterForTests(memoryCounter());
    await expect(consumeRateLimits([], NOW)).rejects.toThrow();
    await expect(consumeRateLimits([{ key: "a", limit: 1, windowSec: 0 }], NOW)).rejects.toThrow();
    await expect(consumeRateLimits([{ key: "a", limit: 1, windowSec: 1.5 }], NOW)).rejects.toThrow();
    await expect(consumeRateLimits([{ key: "a", limit: -1, windowSec: 60 }], NOW)).rejects.toThrow();
  });

  it("throws RateLimitUnavailableError when the counter fails", async () => {
    _setCounterForTests({ incr: vi.fn().mockRejectedValue(new Error("down")), expire: vi.fn() });
    await expect(
      consumeRateLimits([{ key: "a", limit: 1, windowSec: 60 }], NOW),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  });

  describe("without Upstash credentials", () => {
    beforeEach(() => {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
      _setCounterForTests(undefined);
    });
    afterEach(() => vi.unstubAllEnvs());

    it("fails closed in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      await expect(
        consumeRateLimits([{ key: "a", limit: 1, windowSec: 60 }], NOW),
      ).rejects.toBeInstanceOf(RateLimitUnavailableError);
    });

    it("uses an in-memory counter outside production", async () => {
      vi.stubEnv("NODE_ENV", "development");
      await expect(consumeRateLimits([{ key: "dev", limit: 1, windowSec: 60 }], NOW)).resolves.toBe(true);
      await expect(consumeRateLimits([{ key: "dev", limit: 1, windowSec: 60 }], NOW)).resolves.toBe(false);
    });
  });
});
