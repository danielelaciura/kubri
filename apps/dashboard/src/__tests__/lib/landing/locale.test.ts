import { describe, it, expect } from "vitest";
import { resolvePublicLocale } from "@/lib/landing/locale";

describe("resolvePublicLocale", () => {
  it("prefers an explicit ?lang", () => {
    expect(resolvePublicLocale("en")).toBe("en");
    expect(resolvePublicLocale(["it", "en"])).toBe("it");
  });
  it("defaults to Italian otherwise", () => {
    expect(resolvePublicLocale(undefined)).toBe("it");
    expect(resolvePublicLocale("de")).toBe("it");
  });
});
