import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    candidate: { groupBy: vi.fn() },
    pool: { findMany: vi.fn() },
  },
}));

describe("getNewCandidatesForUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns per-pool breakdown using the watermark", async () => {
    const { prisma } = await import("@/lib/db");
    (prisma.candidate.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { poolId: "p1", _count: { _all: 2 } },
    ]);
    (prisma.pool.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "p1", name: "Magazzino" },
    ]);

    const { getNewCandidatesForUser } = await import(
      "@/lib/notifications/new-candidates"
    );
    const res = await getNewCandidatesForUser({
      organizationId: "o1",
      lastNotifiedAt: new Date("2026-05-01T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(res).toEqual([{ poolId: "p1", poolName: "Magazzino", count: 2 }]);
    const where = (prisma.candidate.groupBy as ReturnType<typeof vi.fn>).mock
      .calls[0]![0].where;
    expect(where.createdAt.gt).toEqual(new Date("2026-05-01T00:00:00Z"));
    expect(where.pool.isGlobal).toBe(false);
  });

  it("returns empty when there are no new candidates", async () => {
    const { prisma } = await import("@/lib/db");
    (prisma.candidate.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { getNewCandidatesForUser } = await import(
      "@/lib/notifications/new-candidates"
    );
    const res = await getNewCandidatesForUser({
      organizationId: "o1",
      lastNotifiedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(res).toEqual([]);
    expect(prisma.pool.findMany).not.toHaveBeenCalled();
  });
});
