import { describe, it, expect, vi, beforeEach } from "vitest";
import { cachedFetch, invalidateCache, clearCache } from "@/lib/make/cache";

beforeEach(() => {
  clearCache();
});

describe("cachedFetch", () => {
  it("calls fetcher on cache miss, stores result, and returns it", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "hello" });
    const result = await cachedFetch("key-1", fetcher, 60000);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: "hello" });
  });

  it("returns cached value on cache hit without calling fetcher again", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "hello" });

    await cachedFetch("key-2", fetcher, 60000);
    const result = await cachedFetch("key-2", fetcher, 60000);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: "hello" });
  });

  it("calls fetcher again after TTL expiry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: "first" })
      .mockResolvedValueOnce({ data: "second" });

    const result1 = await cachedFetch("key-3", fetcher, 1); // 1ms TTL
    expect(result1).toEqual({ data: "first" });

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result2 = await cachedFetch("key-3", fetcher, 1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result2).toEqual({ data: "second" });
  });

  it("invalidates cache so next call goes to fetcher", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: "first" })
      .mockResolvedValueOnce({ data: "second" });

    await cachedFetch("make:org1:ds1:list:abc", fetcher, 60000);
    invalidateCache("make:org1");
    const result = await cachedFetch("make:org1:ds1:list:abc", fetcher, 60000);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ data: "second" });
  });

  it("different keys don't interfere with each other", async () => {
    const fetcherA = vi.fn().mockResolvedValue("A");
    const fetcherB = vi.fn().mockResolvedValue("B");

    const resultA = await cachedFetch("key-a", fetcherA, 60000);
    const resultB = await cachedFetch("key-b", fetcherB, 60000);

    expect(resultA).toBe("A");
    expect(resultB).toBe("B");
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);

    // Verify they don't cross-contaminate
    const resultA2 = await cachedFetch("key-a", fetcherA, 60000);
    expect(resultA2).toBe("A");
    expect(fetcherA).toHaveBeenCalledTimes(1);
  });

  it("invalidateCache only affects matching keys", async () => {
    const fetcher1 = vi.fn().mockResolvedValue("org1-data");
    const fetcher2 = vi.fn().mockResolvedValue("org2-data");

    await cachedFetch("make:org1:ds1:list:x", fetcher1, 60000);
    await cachedFetch("make:org2:ds2:list:y", fetcher2, 60000);

    invalidateCache("make:org1");

    // org1 should be invalidated
    await cachedFetch("make:org1:ds1:list:x", fetcher1, 60000);
    expect(fetcher1).toHaveBeenCalledTimes(2);

    // org2 should still be cached
    await cachedFetch("make:org2:ds2:list:y", fetcher2, 60000);
    expect(fetcher2).toHaveBeenCalledTimes(1);
  });
});
