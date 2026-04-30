import { prisma } from "@/lib/db";
import type { PoolModel as Pool } from "@/generated/prisma/models/Pool";

async function getUserWithPools(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      organizationId: true,
      organization: {
        select: {
          pools: {
            select: { poolId: true, pool: true },
          },
        },
      },
    },
  });
}

export async function getAccessiblePoolIds(userId: string): Promise<string[]> {
  const user = await getUserWithPools(userId);

  if (user.role === "ADMIN_KUBRI") {
    const all = await prisma.pool.findMany({ select: { id: true } });
    return all.map((p) => p.id);
  }

  return user.organization?.pools.map((op) => op.poolId) ?? [];
}

export async function getAccessiblePools(userId: string): Promise<Pool[]> {
  const user = await getUserWithPools(userId);

  if (user.role === "ADMIN_KUBRI") {
    return prisma.pool.findMany();
  }

  return user.organization?.pools.map((op) => op.pool) ?? [];
}
