import { describe, expect, it } from "vitest";
import { FakeTranslator } from "../../../src/i18n/fake-translator";

describe("FakeTranslator", () => {
  it("tags the text with the target language, keeps placeholders, records requests", async () => {
    const translator = new FakeTranslator();
    const request = {
      text: "Ciao {name}",
      sourceLanguage: "it",
      targetLanguage: "en",
      kind: "system",
    } as const;

    const translation = await translator.translate(request);

    expect(translation).toEqual({ text: "[en] Ciao {name}", provider: "fake", model: "fake" });
    expect(translator.requests).toEqual([request]);
  });
});
