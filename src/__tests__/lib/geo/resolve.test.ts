import { describe, it, expect } from "vitest";
import { resolveLocation, normalizePlace } from "@/lib/geo/resolve";

describe("normalizePlace", () => {
  it("lowercases, strips accents, collapses whitespace", () => {
    expect(normalizePlace("  Città di Castello ")).toBe("citta di castello");
    expect(normalizePlace("Sant'Angelo")).toBe("sant'angelo");
  });
});

describe("resolveLocation", () => {
  it("resolves a comune to full hierarchy", () => {
    const r = resolveLocation("Milano");
    expect(r.confidence).toBe("exact");
    expect(r.municipality).toBe("Milano");
    expect(r.province).toBe("Milano");
    expect(r.region).toBe("Lombardia");
  });

  it("resolves a province to province + region", () => {
    const r = resolveLocation("Torino");
    expect(r.confidence).toBe("exact");
    expect(r.province).toBe("Torino");
    expect(r.region).toBe("Piemonte");
  });

  it("resolves a region name to region only", () => {
    const r = resolveLocation("Lombardia");
    expect(r.confidence).toBe("exact");
    expect(r.region).toBe("Lombardia");
    expect(r.municipality).toBeUndefined();
    expect(r.province).toBeUndefined();
  });

  it("returns none for unknown input", () => {
    const r = resolveLocation("Atlantide");
    expect(r.confidence).toBe("none");
  });

  it("handles case and accents", () => {
    const r = resolveLocation("città di castello");
    expect(r.confidence).toBe("exact");
    expect(r.municipality).toBe("Città di Castello");
  });

  it("returns partial match within Levenshtein 2", () => {
    const r = resolveLocation("Milno");
    expect(r.confidence).toBe("partial");
    expect(r.municipality).toBe("Milano");
  });
});
