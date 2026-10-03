import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    jobDescription: { count: vi.fn() },
    candidate: { count: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/pools/access", () => ({
  getOrgAccessiblePoolIds: vi.fn(async () => ["p1", "p2"]),
}));

import { getJobsDashboardMetrics } from "@/lib/jobs/dashboard-metrics";

const VISIBILITY = { OR: [{ poolId: { in: ["p1", "p2"] } }, { sharedWithGlobal: true }] };
const NOW = new Date("2026-10-03T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.jobDescription.count.mockResolvedValueOnce(12).mockResolvedValueOnce(3);
  mockPrisma.candidate.count
    .mockResolvedValueOnce(87)
    .mockResolvedValueOnce(312)
    .mockResolvedValueOnce(1240);
});

describe("getJobsDashboardMetrics", () => {
  it("returns the five counts", async () => {
    const m = await getJobsDashboardMetrics("org-1", NOW);
    expect(m).toEqual({
      activeJobs: 12,
      jobsLast30Days: 3,
      targetCandidates: 87,
      neverMatchedCandidates: 312,
      totalCandidates: 1240,
    });
  });

  it("scopes JD counts by org and uses a 30-day window", async () => {
    await getJobsDashboardMetrics("org-1", NOW);
    expect(mockPrisma.jobDescription.count).toHaveBeenNthCalledWith(1, {
      where: { organizationId: "org-1" },
    });
    expect(mockPrisma.jobDescription.count).toHaveBeenNthCalledWith(2, {
      where: { organizationId: "org-1", createdAt: { gte: new Date("2026-09-03T12:00:00.000Z") } },
    });
  });

  it("counts target candidates with score >= 80 in the org, within visibility", async () => {
    await getJobsDashboardMetrics("org-1", NOW);
    expect(mockPrisma.candidate.count).toHaveBeenNthCalledWith(1, {
      where: { ...VISIBILITY, jobMatches: { some: { organizationId: "org-1", llmScore: { gte: 80 } } } },
    });
  });

  it("counts never-matched and total candidates within visibility", async () => {
    await getJobsDashboardMetrics("org-1", NOW);
    expect(mockPrisma.candidate.count).toHaveBeenNthCalledWith(2, {
      where: { ...VISIBILITY, jobMatches: { none: { organizationId: "org-1" } } },
    });
    expect(mockPrisma.candidate.count).toHaveBeenNthCalledWith(3, { where: VISIBILITY });
  });
});
