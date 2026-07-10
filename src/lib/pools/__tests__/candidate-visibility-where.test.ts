import { describe, it, expect } from "vitest";
import { candidateVisibilityWhere } from "@/lib/pools/candidate-visibility";

describe("candidateVisibilityWhere", () => {
  it("matches candidates in the given pools OR any globally-shared one", () => {
    expect(candidateVisibilityWhere(["p1", "p2"])).toEqual({
      OR: [{ poolId: { in: ["p1", "p2"] } }, { sharedWithGlobal: true }],
    });
  });

  it("still matches globally-shared candidates when the org has no pools", () => {
    // poolId: { in: [] } matches nothing, so only sharedWithGlobal=true surfaces.
    expect(candidateVisibilityWhere([])).toEqual({
      OR: [{ poolId: { in: [] } }, { sharedWithGlobal: true }],
    });
  });
});
