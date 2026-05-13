import { describe, it, expect } from "vitest";
import { computeMatchFromScores } from "@/lib/jobs/matcher";
import { MATCHER_CONFIG } from "@/lib/jobs/matcher/config";

const FLOOR = MATCHER_CONFIG.semanticRescale.floor;

describe("computeMatchFromScores", () => {
  it("returns 100 when both components are at the top", () => {
    const result = computeMatchFromScores({ semantic: 1, location: 1 });
    expect(result.final).toBe(100);
    expect(result.breakdown.semantic).toBe(1);
    expect(result.breakdown.location).toBe(1);
  });

  it("returns 0 when both components are 0", () => {
    expect(computeMatchFromScores({ semantic: 0, location: 0 }).final).toBe(0);
  });

  it("rescales semantic so values at the floor map to 0", () => {
    const r = computeMatchFromScores({ semantic: FLOOR, location: 0 });
    expect(r.breakdown.semantic).toBe(0);
    expect(r.final).toBe(0);
  });

  it("rescales semantic so values below the floor stay clamped at 0", () => {
    const r = computeMatchFromScores({ semantic: FLOOR - 0.1, location: 0 });
    expect(r.breakdown.semantic).toBe(0);
  });

  it("rescales midway between floor and 1 to ~0.5", () => {
    const mid = FLOOR + (1 - FLOOR) / 2;
    const r = computeMatchFromScores({ semantic: mid, location: 0 });
    expect(r.breakdown.semantic).toBeCloseTo(0.5, 5);
  });

  it("weights semantic more than location", () => {
    const a = computeMatchFromScores({ semantic: 1, location: 0 }).final;
    const b = computeMatchFromScores({ semantic: 0, location: 1 }).final;
    expect(a).toBeGreaterThan(b);
    expect(a).toBe(Math.round(100 * MATCHER_CONFIG.weights.semantic));
    expect(b).toBe(Math.round(100 * MATCHER_CONFIG.weights.location));
  });
});
