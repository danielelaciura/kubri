import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeStats } from "@/lib/stats/compute";
import type { Candidate } from "@/types";

function makeCandidate(
  overrides: Partial<Candidate> = {},
): Candidate {
  return {
    id: overrides.id ?? "1",
    name: overrides.name ?? "Test User",
    nationality: "Italian",
    languages: ["it"],
    skills: [],
    workExperiences: [],
    availability: "immediate",
    city: "Roma",
    interviewTranscript: [],
    channel: "telegram",
    createdAt: overrides.createdAt ?? new Date("2026-03-30T10:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-03-30T10:00:00Z"),
  };
}

describe("computeStats", () => {
  beforeEach(() => {
    // Fix "now" to 2026-04-03 12:00:00 UTC for deterministic week calculations
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns zero total and empty week counts for an empty array", () => {
    const stats = computeStats([]);

    expect(stats.total).toBe(0);
    expect(stats.weeklyTrend).toHaveLength(8);
    for (const week of stats.weeklyTrend) {
      expect(week.count).toBe(0);
    }
  });

  it("counts a single candidate correctly", () => {
    const candidates = [makeCandidate()];
    const stats = computeStats(candidates);

    expect(stats.total).toBe(1);
  });

  it("groups candidates by week for the last 8 weeks", () => {
    // "now" is 2026-04-03. Create candidates at known dates.
    const candidates = [
      // This week (week starting ~2026-04-03)
      makeCandidate({ id: "1", createdAt: new Date("2026-04-03T08:00:00Z") }),
      makeCandidate({ id: "2", createdAt: new Date("2026-04-02T08:00:00Z") }),
      // One week ago (~2026-03-27)
      makeCandidate({ id: "3", createdAt: new Date("2026-03-28T08:00:00Z") }),
      // Two weeks ago (~2026-03-20)
      makeCandidate({ id: "4", createdAt: new Date("2026-03-22T08:00:00Z") }),
      makeCandidate({ id: "5", createdAt: new Date("2026-03-21T08:00:00Z") }),
      // Very old candidate — outside the 8 week window
      makeCandidate({ id: "6", createdAt: new Date("2026-01-01T08:00:00Z") }),
    ];

    const stats = computeStats(candidates);

    expect(stats.weeklyTrend).toHaveLength(8);
    // The total of weekly counts should not include the old candidate
    const weeklyTotal = stats.weeklyTrend.reduce((sum, w) => sum + w.count, 0);
    expect(weeklyTotal).toBe(5);
  });

  it("formats week labels as dd/mm", () => {
    const stats = computeStats([]);
    for (const week of stats.weeklyTrend) {
      expect(week.week).toMatch(/^\d{2}\/\d{2}$/);
    }
  });

  it("counts total for multiple candidates", () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ id: String(i) }),
    );

    const stats = computeStats(candidates);

    expect(stats.total).toBe(5);
  });
});
