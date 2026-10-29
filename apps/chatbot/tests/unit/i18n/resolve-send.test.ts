import { describe, expect, it } from "vitest";
import { FakeTranslator } from "../../../src/i18n/fake-translator";
import { createTextResolver, type SendTextEffect } from "../../../src/i18n/resolve";
import { MemoryTranslationCache } from "../../../src/i18n/translation-cache";
import type { Translator } from "../../../src/i18n/translator";
import { campaign } from "../engine/helpers";

const resolver = createTextResolver({
  translator: new FakeTranslator(),
  cache: new MemoryTranslationCache(),
});
const target = { campaign: campaign(), language: "it" } as const;
const QUESTION = { it: "Raccontami le tue esperienze di lavoro." };

const send = (
  purpose: SendTextEffect["purpose"],
  params?: Record<string, string>,
): SendTextEffect => ({
  type: "SendText",
  text: { kind: "step", path: "lavoro.esperienze", text: QUESTION, ...(params ? { params } : {}) },
  ...(purpose ? { purpose } : {}),
});

describe("resolveSend", () => {
  it("sends the text alone when there is no purpose", async () => {
    expect((await resolver.resolveSend(send(undefined), target)).text).toBe(QUESTION.it);
  });

  it("puts what is missing before the question of a clarification", async () => {
    const result = await resolver.resolveSend(
      send("clarify", { missing: "gli anni in cui hai lavorato" }),
      target,
    );

    expect(result.text).toBe(
      "Mi serve ancora un dettaglio: gli anni in cui hai lavorato\nRaccontami le tue esperienze di lavoro.",
    );
    expect(result.missingParams).toEqual([]);
  });

  it("sends a clarification without `missing` as the plain question", async () => {
    expect((await resolver.resolveSend(send("clarify"), target)).text).toBe(QUESTION.it);
  });

  it("introduces a rephrased question", async () => {
    expect((await resolver.resolveSend(send("rephrase"), target)).text).toBe(
      "Provo a spiegarmi meglio:\nRaccontami le tue esperienze di lavoro.",
    );
  });

  it("is curated only if both parts are", async () => {
    const result = await resolver.resolveSend(send("rephrase"), { ...target, language: "en" });

    expect(result.isCurated).toBe(false);
    expect(result.text).toBe(
      "[en] Provo a spiegarmi meglio:\n[en] Raccontami le tue esperienze di lavoro.",
    );
  });

  it("writes the lead in the language the question ended up in", async () => {
    // The question's translation fails (Italian fallback): the lead must not stay in English.
    const fake = new FakeTranslator();
    const translator: Translator = {
      translate: (request) =>
        request.text === QUESTION.it ? Promise.reject(new Error("down")) : fake.translate(request),
    };
    const mixed = createTextResolver({ translator, cache: new MemoryTranslationCache() });

    const result = await mixed.resolveSend(send("rephrase"), { ...target, language: "en" });

    expect(result).toMatchObject({
      text: "Provo a spiegarmi meglio:\nRaccontami le tue esperienze di lavoro.",
      language: "it",
    });
    expect(fake.requests).toEqual([]);
  });

  describe("consent texts", () => {
    const consentSend = (text: Record<string, string>): SendTextEffect => ({
      type: "SendText",
      text: { kind: "step", path: "privacy", text: { it: "Accetti?", ...text } },
      purpose: "rephrase",
    });

    it("keeps a curated consent curated under a machine-translated lead", async () => {
      const result = await resolver.resolveSend(consentSend({ en: "Do you accept?" }), {
        ...target,
        language: "en",
      });

      expect(result).toMatchObject({
        text: "[en] Provo a spiegarmi meglio:\nDo you accept?",
        critical: true,
        isCurated: true,
      });
    });

    it("keeps a machine-translated consent uncurated", async () => {
      const result = await resolver.resolveSend(consentSend({}), { ...target, language: "en" });

      expect(result).toMatchObject({ critical: true, isCurated: false });
      expect(result.text).toContain("https://example.com/privacy");
    });
  });
});
