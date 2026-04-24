import { describe, it, expect } from "vitest";
import { normalize, tokenize, stem, tokenSet } from "@/lib/jobs/matcher/tokens";

describe("normalize", () => {
  it("lowercases and strips accents and punctuation", () => {
    expect(normalize("  Città! di Castello? ")).toBe("citta di castello");
  });
});

describe("tokenize", () => {
  it("splits on whitespace after normalize", () => {
    expect(tokenize("  Cameriere/Barista ")).toEqual(["cameriere", "barista"]);
  });

  it("removes Italian stopwords", () => {
    expect(tokenize("il lavoro di cameriere per una azienda")).not.toContain("il");
    expect(tokenize("il lavoro di cameriere per una azienda")).toContain("cameriere");
  });

  it("drops tokens shorter than 2 chars", () => {
    expect(tokenize("a lavoro")).toEqual(["lavoro"]);
  });
});

describe("stem", () => {
  it("stems Italian words to a common form", () => {
    const a = stem("pulizie");
    const b = stem("pulizia");
    const c = stem("pulire");
    expect(a).toBe(b);
    expect(c.length).toBeGreaterThan(0);
  });
});

describe("tokenSet", () => {
  it("produces a set of stemmed tokens", () => {
    const s = tokenSet("Pulizie di uffici, cameriere di sala");
    expect(s.has(stem("pulizie"))).toBe(true);
    expect(s.has(stem("cameriere"))).toBe(true);
  });
});
