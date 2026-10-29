import { describe, it, expect } from "vitest";
import { resolvePublicLocale } from "@/lib/landing/locale";

describe("resolvePublicLocale", () => {
  it("prefers an explicit ?lang", () => {
    expect(resolvePublicLocale("en", "it-IT,it;q=0.9")).toBe("en");
    expect(resolvePublicLocale(["it", "en"], "en-US")).toBe("it");
  });
  it("falls back to an English browser", () => {
    expect(resolvePublicLocale(undefined, "en-GB,en;q=0.9")).toBe("en");
  });
  it("defaults to Italian otherwise", () => {
    expect(resolvePublicLocale(undefined, "fr-FR,fr;q=0.9")).toBe("it");
    expect(resolvePublicLocale("de", null)).toBe("it");
  });
});
