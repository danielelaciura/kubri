import { describe, expect, it } from "vitest";
import { FakeTranslator } from "../../../src/i18n/fake-translator";
import { createTextResolver } from "../../../src/i18n/resolve";
import { MemoryTranslationCache } from "../../../src/i18n/translation-cache";
import { campaign } from "../engine/helpers";

const resolver = () =>
  createTextResolver({ translator: new FakeTranslator(), cache: new MemoryTranslationCache() });
const target = (language: string) => ({ campaign: campaign(), language });

describe("resolveKey", () => {
  it.each([
    ["choice.yes", "Sì"],
    ["choice.no", "No"],
    ["choice.idk", "Non so"],
    ["choice.accepted", "Accetto"],
    ["choice.declined", "Non accetto"],
    ["choice.list_button", "Scegli"],
    ["choice.language_button", "Lingua / Language"],
    ["choice.prompt", "Scegli una risposta:"],
  ] as const)("%s is %j in Italian", async (key, expected) => {
    expect((await resolver().resolveKey(key, target("it"))).text).toBe(expected);
  });

  it("translates it for another language, through the usual chain", async () => {
    const result = await resolver().resolveKey("choice.accepted", target("en"));

    expect(result).toMatchObject({ text: "[en] Accetto", source: "translated", isCurated: false });
  });

  it("has the text for audio and documents (D121)", async () => {
    expect((await resolver().resolveKey("media.text_only", target("it"))).text).toContain(
      "solo messaggi di testo",
    );
  });
});

describe("resolveLabel", () => {
  it("resolves a short localized text with no parameters", async () => {
    expect((await resolver().resolveLabel({ it: "intermedio" }, target("it"))).text).toBe(
      "intermedio",
    );
    expect((await resolver().resolveLabel({ it: "intermedio" }, target("ar"))).text).toBe(
      "[ar] intermedio",
    );
  });

  it("prefers a curated translation", async () => {
    const result = await resolver().resolveLabel(
      { it: "Magazzino", en: "Warehouse" },
      target("en"),
    );

    expect(result).toMatchObject({ text: "Warehouse", isCurated: true });
  });
});
