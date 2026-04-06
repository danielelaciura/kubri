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
    interviewStatus: overrides.interviewStatus ?? "completed",
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

  it("returns zero counts and empty week counts for an empty array", () => {
    const stats = computeStats([]);

    expect(stats.total).toBe(0);
    expect(stats.byStatus).toEqual({
      completed: 0,
      in_progress: 0,
      abandoned: 0,
      incomplete: 0,
    });
    expect(stats.weeklyTrend).toHaveLength(8);
    for (const week of stats.weeklyTrend) {
      expect(week.count).toBe(0);
    }
  });

  it("counts a single completed candidate correctly", () => {
    const candidates = [makeCandidate({ interviewStatus: "completed" })];
    const stats = computeStats(candidates);

    expect(stats.total).toBe(1);
    expect(stats.byStatus.completed).toBe(1);
    expect(stats.byStatus.in_progress).toBe(0);
    expect(stats.byStatus.abandoned).toBe(0);
    expect(stats.byStatus.incomplete).toBe(0);
  });

  it("counts by interview status correctly with various distributions", () => {
    const candidates = [
      makeCandidate({ id: "1", interviewStatus: "completed" }),
      makeCandidate({ id: "2", interviewStatus: "completed" }),
      makeCandidate({ id: "3", interviewStatus: "completed" }),
      makeCandidate({ id: "4", interviewStatus: "in_progress" }),
      makeCandidate({ id: "5", interviewStatus: "in_progress" }),
      makeCandidate({ id: "6", interviewStatus: "abandoned" }),
      makeCandidate({ id: "7", interviewStatus: "incomplete" }),
    ];

    const stats = computeStats(candidates);

    expect(stats.total).toBe(7);
    expect(stats.byStatus.completed).toBe(3);
    expect(stats.byStatus.in_progress).toBe(2);
    expect(stats.byStatus.abandoned).toBe(1);
    expect(stats.byStatus.incomplete).toBe(1);
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

  it("handles all candidates in a single status", () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ id: String(i), interviewStatus: "abandoned" }),
    );

    const stats = computeStats(candidates);

    expect(stats.total).toBe(5);
    expect(stats.byStatus.abandoned).toBe(5);
    expect(stats.byStatus.completed).toBe(0);
    expect(stats.byStatus.in_progress).toBe(0);
    expect(stats.byStatus.incomplete).toBe(0);
  });
});
