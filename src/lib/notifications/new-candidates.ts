import { prisma } from "@/lib/db";
import type { PoolBreakdown } from "./types";

interface RecipientWindow {
  organizationId: string;
  lastNotifiedAt: Date | null;
  createdAt: Date;
}

export async function getNewCandidatesForUser(
  user: RecipientWindow,
): Promise<PoolBreakdown[]> {
  const since = user.lastNotifiedAt ?? user.createdAt;

  const groups = await prisma.candidate.groupBy({
    by: ["poolId"],
    where: {
      createdAt: { gt: since },
      pool: {
        isGlobal: false,
        organizations: { some: { organizationId: user.organizationId } },
      },
    },
    _count: { _all: true },
  });

  if (groups.length === 0) return [];

  const pools = await prisma.pool.findMany({
    where: { id: { in: groups.map((g) => g.poolId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(pools.map((p) => [p.id, p.name]));

  return groups.map((g) => ({
    poolId: g.poolId,
    poolName: nameById.get(g.poolId) ?? "—",
    count: g._count._all,
  }));
}
