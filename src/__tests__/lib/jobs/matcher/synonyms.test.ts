import { describe, it, expect } from "vitest";
import { expandTokens } from "@/lib/jobs/matcher/synonyms";
import { stem } from "@/lib/jobs/matcher/tokens";

describe("expandTokens", () => {
  it("expands a term to its synonyms (post-stem)", () => {
    const s = expandTokens(new Set([stem("cleaning")]));
    expect(s.has(stem("pulizie"))).toBe(true);
    expect(s.has(stem("addetto"))).toBe(true);
  });

  it("expands Italian to English equivalents", () => {
    const s = expandTokens(new Set([stem("cameriere")]));
    expect(s.has(stem("waiter"))).toBe(true);
  });

  it("returns the original set unchanged when no synonyms apply", () => {
    const s = expandTokens(new Set([stem("quantistica")]));
    expect(s.size).toBe(1);
  });
});
