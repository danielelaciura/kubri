import { describe, expect, it } from "vitest";
import { FakeTranslator } from "../../../src/i18n/fake-translator";
import { resolveTemplate } from "../../../src/i18n/translate-template";
import {
  MemoryTranslationCache,
  sourceHash,
  type TranslationCache,
} from "../../../src/i18n/translation-cache";
import type { Translator } from "../../../src/i18n/translator";

const TEXT = { it: "Ciao {name}" };

function setup(translator: Translator = new FakeTranslator()) {
  const cache = new MemoryTranslationCache();
  return { cache, translator, services: { translator, cache } };
}

describe("resolveTemplate", () => {
  it("uses the Italian text for Italian, without translating", async () => {
    const { services, translator } = setup();

    expect(await resolveTemplate(TEXT, "it", "system", services)).toEqual({
      template: "Ciao {name}",
      language: "it",
      source: "reference",
      isCurated: true,
    });
    expect((translator as FakeTranslator).requests).toEqual([]);
  });

  it("prefers a curated translation", async () => {
    const { services, translator } = setup();

    const result = await resolveTemplate({ ...TEXT, en: "Hi {name}" }, "en", "campaign", services);

    expect(result).toEqual({
      template: "Hi {name}",
      language: "en",
      source: "curated",
      isCurated: true,
    });
    expect((translator as FakeTranslator).requests).toEqual([]);
  });

  it.each([true, false])("uses the cache, curated only if reviewed (%s)", async (reviewed) => {
    const { services, cache } = setup();
    await cache.set(sourceHash("Ciao {name}"), "en", {
      text: "Hello {name}",
      reviewed,
      provider: "p",
      model: "m",
    });

    expect(await resolveTemplate(TEXT, "en", "system", services)).toEqual({
      template: "Hello {name}",
      language: "en",
      source: "cache",
      isCurated: reviewed,
    });
  });

  it("translates the template once, then serves it from the cache", async () => {
    const translator = new FakeTranslator();
    const { services, cache } = setup(translator);

    const first = await resolveTemplate(TEXT, "en", "label", services);
    const second = await resolveTemplate(TEXT, "en", "label", services);

    expect(first).toEqual({
      template: "[en] Ciao {name}",
      language: "en",
      source: "translated",
      isCurated: false,
    });
    expect(second.source).toBe("cache");
    expect(translator.requests).toEqual([
      { text: "Ciao {name}", sourceLanguage: "it", targetLanguage: "en", kind: "label" },
    ]);
    expect(await cache.get(sourceHash("Ciao {name}"), "en")).toEqual({
      text: "[en] Ciao {name}",
      reviewed: false,
      provider: "fake",
      model: "fake",
    });
  });

  it("falls back to Italian, uncached, when the translator fails", async () => {
    const { services, cache } = setup({ translate: () => Promise.reject(new Error("down")) });

    expect(await resolveTemplate(TEXT, "en", "system", services)).toEqual({
      template: "Ciao {name}",
      language: "it",
      source: "fallback",
      isCurated: true,
    });
    expect(cache.size).toBe(0);
  });

  it.each(["", "   ", "Hello", "Hello {nome}", "Hello {name} {name2}", "Hello {name.x}"])(
    "falls back to Italian when the translation %j is empty or breaks the placeholders",
    async (text) => {
      const { services, cache } = setup({
        translate: () => Promise.resolve({ text, provider: "p", model: "m" }),
      });

      expect((await resolveTemplate(TEXT, "en", "system", services)).source).toBe("fallback");
      expect(cache.size).toBe(0);
    },
  );

  it("still translates when the cache fails", async () => {
    const broken: TranslationCache = {
      get: () => Promise.reject(new Error("db down")),
      set: () => Promise.reject(new Error("db down")),
    };

    const result = await resolveTemplate(TEXT, "en", "system", {
      translator: new FakeTranslator(),
      cache: broken,
    });

    expect(result.source).toBe("translated");
  });
});
