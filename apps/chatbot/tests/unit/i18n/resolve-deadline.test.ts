import { describe, expect, it } from "vitest";
import type { TextRef } from "../../../src/engine/text-ref";
import { createTextResolver } from "../../../src/i18n/resolve";
import { MemoryTranslationCache } from "../../../src/i18n/translation-cache";
import type { Translator } from "../../../src/i18n/translator";
import { campaign } from "../engine/helpers";

/** A translator that never answers, as a hung LLM call would. */
const HANGING: Translator = { translate: () => new Promise(() => undefined) };

const inline = (it: string): TextRef => ({ kind: "step", path: "x", text: { it } });

describe("TextResolver.withDeadline", () => {
  it("falls back to Italian once the deadline has passed (D72)", async () => {
    const resolver = createTextResolver({
      translator: HANGING,
      cache: new MemoryTranslationCache(),
    }).withDeadline(Date.now() + 50);

    const result = await resolver.resolve(inline("Buongiorno"), {
      campaign: campaign(),
      language: "en",
    });

    expect(result).toMatchObject({ text: "Buongiorno", language: "it", source: "fallback" });
  });

  it("is one budget for every text: many hanging translations wait for it once", async () => {
    const resolver = createTextResolver({
      translator: HANGING,
      cache: new MemoryTranslationCache(),
    }).withDeadline(Date.now() + 200);
    const target = { campaign: campaign(), language: "en" } as const;
    const started = Date.now();

    for (let i = 0; i < 10; i += 1) {
      await resolver.resolve(inline(`Testo ${String(i)}`), target);
    }

    // Ten calls, one 200 ms budget: far from 10 × 200 ms.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("does not change a translator that answers in time", async () => {
    const translator: Translator = {
      translate: (request) =>
        Promise.resolve({ text: `[en] ${request.text}`, provider: "fake", model: "fake" }),
    };
    const resolver = createTextResolver({
      translator,
      cache: new MemoryTranslationCache(),
    }).withDeadline(Date.now() + 5000);

    const result = await resolver.resolve(inline("Buongiorno"), {
      campaign: campaign(),
      language: "en",
    });

    expect(result).toMatchObject({ text: "[en] Buongiorno", language: "en" });
  });
});
