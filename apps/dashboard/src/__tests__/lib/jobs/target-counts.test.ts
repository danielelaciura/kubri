import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    jobMatch: { groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/pools/access", () => ({
  getOrgAccessiblePoolIds: vi.fn(async () => ["p1"]),
}));

import { getTargetCountsByJob } from "@/lib/jobs/dashboard-metrics";

beforeEach(() => vi.clearAllMocks());

describe("getTargetCountsByJob", () => {
  it("groups target matches by JD, scoped by org, threshold and visibility", async () => {
    mockPrisma.jobMatch.groupBy.mockResolvedValue([
      { jobDescriptionId: "jd-1", _count: { _all: 4 } },
      { jobDescriptionId: "jd-2", _count: { _all: 1 } },
    ]);

    const counts = await getTargetCountsByJob("org-1");

    expect(mockPrisma.jobMatch.groupBy).toHaveBeenCalledWith({
      by: ["jobDescriptionId"],
      where: {
        organizationId: "org-1",
        llmScore: { gte: 80 },
        candidate: { OR: [{ poolId: { in: ["p1"] } }, { sharedWithGlobal: true }] },
      },
      _count: { _all: true },
    });
    expect(counts).toEqual(new Map([["jd-1", 4], ["jd-2", 1]]));
  });

  it("returns an empty map when no JD has target matches", async () => {
    mockPrisma.jobMatch.groupBy.mockResolvedValue([]);
    expect(await getTargetCountsByJob("org-1")).toEqual(new Map());
  });
});
