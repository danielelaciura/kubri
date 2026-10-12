import { describe, it, expect } from "vitest";
import { candidateVisibilityWhere } from "@/lib/pools/candidate-visibility";

describe("candidateVisibilityWhere", () => {
  it("adds globally-shared candidates when the org is attached to the Global pool", () => {
    expect(candidateVisibilityWhere(["p1", "p2"], true)).toEqual({
      OR: [{ poolId: { in: ["p1", "p2"] } }, { sharedWithGlobal: true }],
    });
  });

  it("restricts an isolated org (no Global pool) to its own pools only", () => {
    expect(candidateVisibilityWhere(["p1"], false)).toEqual({ poolId: { in: ["p1"] } });
  });

  it("matches nothing for an isolated org with no pools", () => {
    expect(candidateVisibilityWhere([], false)).toEqual({ poolId: { in: [] } });
  });
});
