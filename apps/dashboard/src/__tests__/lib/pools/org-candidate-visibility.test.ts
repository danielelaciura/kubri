import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { organizationPool: { findMany: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { getOrgCandidateVisibility } from "@/lib/pools/access";

beforeEach(() => vi.clearAllMocks());

describe("getOrgCandidateVisibility", () => {
  it("lets an org attached to the Global pool see globally-shared candidates", async () => {
    mockPrisma.organizationPool.findMany.mockResolvedValue([
      { poolId: "global", pool: { isGlobal: true } },
      { poolId: "p1", pool: { isGlobal: false } },
    ]);

    expect(await getOrgCandidateVisibility("org-1")).toEqual({
      OR: [{ poolId: { in: ["global", "p1"] } }, { sharedWithGlobal: true }],
    });
    expect(mockPrisma.organizationPool.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      select: { poolId: true, pool: { select: { isGlobal: true } } },
    });
  });

  it("keeps an isolated org (only private pools) out of globally-shared candidates", async () => {
    mockPrisma.organizationPool.findMany.mockResolvedValue([
      { poolId: "activa", pool: { isGlobal: false } },
    ]);

    expect(await getOrgCandidateVisibility("org-activa")).toEqual({
      poolId: { in: ["activa"] },
    });
  });

  it("matches nothing for an org with no pools", async () => {
    mockPrisma.organizationPool.findMany.mockResolvedValue([]);
    expect(await getOrgCandidateVisibility("org-empty")).toEqual({ poolId: { in: [] } });
  });
});
