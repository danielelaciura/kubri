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

/**
 * Returns the pool IDs attached to the given organization.
 * Unlike `getAccessiblePoolIds`, this is org-scoped and does NOT apply
 * the ADMIN_KUBRI bypass — orgs see only their own pools regardless of
 * the requesting user's role.
 */
export async function getOrgAccessiblePoolIds(
  organizationId: string,
): Promise<string[]> {
  const rows = await prisma.organizationPool.findMany({
    where: { organizationId },
    select: { poolId: true },
  });
  return rows.map((r) => r.poolId);
}

/**
 * Returns the full Pool objects attached to the given organization.
 * Org-scoped; no admin bypass.
 */
export async function getOrgAccessiblePools(
  organizationId: string,
): Promise<Pool[]> {
  const rows = await prisma.organizationPool.findMany({
    where: { organizationId },
    select: { pool: true },
  });
  return rows.map((r) => r.pool);
}
