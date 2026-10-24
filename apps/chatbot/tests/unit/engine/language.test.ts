import { describe, expect, it } from "vitest";
import { chooseLanguage, detectLanguageName } from "../../../src/engine/language";
import { interpretation } from "./helpers";

describe("detectLanguageName", () => {
  it.each([
    ["italiano", "it"],
    ["Arabo", "ar"],
    ["العربية", "ar"],
    ["english please", "en"],
    ["vorrei parlare in français", "fr"],
    ["українська", "uk"],
    ["中文", "zh"],
  ])("%j → %s", (text, code) => {
    expect(detectLanguageName(text)).toBe(code);
  });

  it.each(["ciao", "sì", ""])("returns undefined for %j", (text) => {
    expect(detectLanguageName(text)).toBeUndefined();
  });
});

describe("chooseLanguage", () => {
  it("prefers a language name written in the text", () => {
    const interp = interpretation({ language: { code: "it", confidence: 0.99 } });
    expect(chooseLanguage("arabo", interp, "it")).toBe("ar");
  });

  it("falls back to the detected language when confident enough", () => {
    const interp = interpretation({ language: { code: "ar", confidence: 0.9 } });
    expect(chooseLanguage("مرحبا", interp, "it")).toBe("ar");
  });

  it("ignores a detection below 0.8", () => {
    const interp = interpretation({ language: { code: "en", confidence: 0.6 } });
    expect(chooseLanguage("hello?", interp, "it")).toBe("it");
  });

  it("uses the campaign default without an interpretation", () => {
    expect(chooseLanguage("ok", null, "en")).toBe("en");
  });
});
