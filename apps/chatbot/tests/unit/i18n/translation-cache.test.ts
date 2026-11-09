import { describe, expect, it } from "vitest";
import { MemoryTranslationCache, sourceHash } from "../../../src/i18n/translation-cache";

describe("sourceHash", () => {
  it("is the sha256 of the Italian text, in hex", () => {
    expect(sourceHash("Ciao")).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceHash("Ciao")).toBe(sourceHash("Ciao"));
    expect(sourceHash("Ciao")).not.toBe(sourceHash("Ciao!"));
  });
});

describe("MemoryTranslationCache", () => {
  it("stores one entry per source and language", async () => {
    const cache = new MemoryTranslationCache();
    const entry = { text: "Hi", reviewed: false, provider: "fake", model: "fake" };

    await cache.set("h1", "en", entry);

    expect(await cache.get("h1", "en")).toEqual(entry);
    expect(await cache.get("h1", "fr")).toBeUndefined();
    expect(cache.size).toBe(1);
  });
});
