import { describe, expect, it } from "vitest";
import { LanguageCodeSchema, LocalizedTextSchema } from "../../../src/i18n/localized-text";

describe("LanguageCodeSchema", () => {
  it("accepts ISO 639-1 lowercase codes", () => {
    expect(LanguageCodeSchema.safeParse("ar").success).toBe(true);
  });

  it.each(["IT", "ita", "i", "it-IT"])("rejects %s", (code) => {
    expect(LanguageCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("LocalizedTextSchema", () => {
  it("accepts Italian with optional curated translations", () => {
    const result = LocalizedTextSchema.safeParse({ it: "Ciao", en: "Hello" });
    expect(result.success).toBe(true);
  });

  it("requires the Italian text", () => {
    const result = LocalizedTextSchema.safeParse({ en: "Hello" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/Italian/);
  });

  it("rejects empty texts", () => {
    expect(LocalizedTextSchema.safeParse({ it: "   " }).success).toBe(false);
  });

  it("rejects invalid language keys", () => {
    expect(LocalizedTextSchema.safeParse({ it: "Ciao", english: "Hello" }).success).toBe(false);
  });
});
