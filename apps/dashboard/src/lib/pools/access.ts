import { prisma } from "@/lib/db";
import type { PoolModel as Pool } from "@/generated/prisma/models/Pool";
import type { Prisma } from "@/generated/prisma/client";
import { candidateVisibilityWhere } from "@/lib/pools/candidate-visibility";

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

/**
 * Prisma `where` fragment for the candidates the given organization may see.
 * Globally-shared candidates are included only when the org is attached to the
 * Global pool; isolated orgs see strictly their own pools. Org-scoped; no admin
 * bypass. Use this for every org-scoped candidate read or access check.
 */
export async function getOrgCandidateVisibility(
  organizationId: string,
): Promise<Prisma.CandidateWhereInput> {
  const rows = await prisma.organizationPool.findMany({
    where: { organizationId },
    select: { poolId: true, pool: { select: { isGlobal: true } } },
  });
  return candidateVisibilityWhere(
    rows.map((r) => r.poolId),
    rows.some((r) => r.pool.isGlobal),
  );
}

/**
 * Pools the organization may create candidates in: its own pools, never the
 * Global pool. Org-scoped; no admin bypass.
 */
export async function getOrgWritablePools(organizationId: string): Promise<Pool[]> {
  const pools = await getOrgAccessiblePools(organizationId);
  return pools.filter((p) => !p.isGlobal).sort((a, b) => a.name.localeCompare(b.name));
}
