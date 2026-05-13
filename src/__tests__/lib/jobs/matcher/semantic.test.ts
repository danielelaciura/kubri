import { describe, it, expect } from "vitest";
import { computeMatchFromScores } from "@/lib/jobs/matcher";
import { MATCHER_CONFIG } from "@/lib/jobs/matcher/config";

describe("computeMatchFromScores", () => {
  it("combines semantic and location with the configured weights", () => {
    const result = computeMatchFromScores({ semantic: 1, location: 1 });
    expect(result.final).toBe(100);
    expect(result.breakdown).toEqual({ semantic: 1, location: 1 });
  });

  it("returns 0 when both components are 0", () => {
    expect(computeMatchFromScores({ semantic: 0, location: 0 }).final).toBe(0);
  });

  it("rounds correctly", () => {
    // 0.7 * 0.5 + 0.3 * 0.5 = 0.5 → 50
    expect(computeMatchFromScores({ semantic: 0.5, location: 0.5 }).final).toBe(50);
  });

  it("weights semantic more than location", () => {
    const a = computeMatchFromScores({ semantic: 1, location: 0 }).final;
    const b = computeMatchFromScores({ semantic: 0, location: 1 }).final;
    expect(a).toBeGreaterThan(b);
    expect(a).toBe(Math.round(100 * MATCHER_CONFIG.weights.semantic));
    expect(b).toBe(Math.round(100 * MATCHER_CONFIG.weights.location));
  });
});
