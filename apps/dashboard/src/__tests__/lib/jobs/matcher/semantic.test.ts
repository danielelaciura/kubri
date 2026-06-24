import { describe, it, expect } from "vitest";
import { computeMatchFromScores } from "@/lib/jobs/matcher";
import { MATCHER_CONFIG } from "@/lib/jobs/matcher/config";

describe("computeMatchFromScores", () => {
  it("returns 100 when semantic is 1.0 (location no longer contributes)", () => {
    const r = computeMatchFromScores({ semantic: 1, location: 1 });
    expect(r.final).toBe(100);
  });

  it("returns 0 when semantic is 0 regardless of location", () => {
    expect(computeMatchFromScores({ semantic: 0, location: 0 }).final).toBe(0);
    expect(computeMatchFromScores({ semantic: 0, location: 1 }).final).toBe(0);
  });

  it("ignores location entirely (weight = 0)", () => {
    const withLoc = computeMatchFromScores({ semantic: 0.8, location: 1 }).final;
    const noLoc = computeMatchFromScores({ semantic: 0.8, location: 0 }).final;
    expect(withLoc).toBe(noLoc);
  });

  it("scales semantic linearly to final score", () => {
    expect(computeMatchFromScores({ semantic: 0.5, location: 0 }).final).toBe(50);
    expect(computeMatchFromScores({ semantic: 0.85, location: 0 }).final).toBe(85);
  });

  it("config uses pure-semantic weights", () => {
    expect(MATCHER_CONFIG.weights.semantic).toBe(1.0);
    expect(MATCHER_CONFIG.weights.location).toBe(0.0);
  });

  it("config has the location hard-filter enabled", () => {
    expect(MATCHER_CONFIG.locationFilter.enabled).toBe(true);
  });
});
