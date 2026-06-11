"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth-utils";
import { logAudit } from "@/lib/audit";
import {
  poolCreateSchema,
  poolUpdateSchema,
  type PoolCreateInput,
  type PoolUpdateInput,
} from "@/lib/validations/pool";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";

export async function createPool(input: PoolCreateInput) {
  const admin = await requireRole("ADMIN_KUBRI");
  const data = poolCreateSchema.parse(input);
  const pool = await prisma.pool.create({ data });
  await logAudit({
    userId: admin.id,
    organizationId: null,
    action: "create_pool",
    resourceType: "Pool",
    resourceId: pool.id,
    metadata: {
      name: pool.name,
      slug: pool.slug,
      externalKey: pool.externalKey,
    },
  });
  revalidatePath("/admin/pools");
  return pool;
}

export async function updatePool(id: string, input: PoolUpdateInput) {
  const admin = await requireRole("ADMIN_KUBRI");
  const data = poolUpdateSchema.parse(input);
  const pool = await prisma.pool.update({ where: { id }, data });
  await logAudit({
    userId: admin.id,
    organizationId: null,
    action: "update_pool",
    resourceType: "Pool",
    resourceId: pool.id,
    metadata: data,
  });
  revalidatePath("/admin/pools");
  revalidatePath(`/admin/pools/${id}`);
  return pool;
}

export async function deletePool(id: string) {
  const admin = await requireRole("ADMIN_KUBRI");
  const t = getDictionary(await getServerLocale());
  // Block deleting the global pool explicitly (in addition to the partial unique
  // constraint, this gives a clear UX error).
  const pool = await prisma.pool.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true, isGlobal: true },
  });
  if (!pool) throw new Error("Pool non trovato");
  if (pool.isGlobal) throw new Error(t.pools.cannotDeleteGlobal);

  // ON DELETE RESTRICT on candidates+OrganizationPool will reject if the pool is
  // attached or has candidates. Let Prisma surface the error to the UI.
  await prisma.pool.delete({ where: { id } });

  await logAudit({
    userId: admin.id,
    organizationId: null,
    action: "delete_pool",
    resourceType: "Pool",
    resourceId: id,
    metadata: { name: pool.name, slug: pool.slug },
  });
  revalidatePath("/admin/pools");
}

export async function attachOrgToPool(poolId: string, organizationId: string) {
  const admin = await requireRole("ADMIN_KUBRI");
  await prisma.organizationPool.create({ data: { poolId, organizationId } });
  await logAudit({
    userId: admin.id,
    organizationId,
    action: "attach_pool",
    resourceType: "OrganizationPool",
    resourceId: `${organizationId}:${poolId}`,
    metadata: { poolId, organizationId },
  });
  revalidatePath(`/admin/pools/${poolId}`);
  revalidatePath(`/admin/organizations/${organizationId}`);
}

export async function detachOrgFromPool(poolId: string, organizationId: string) {
  const admin = await requireRole("ADMIN_KUBRI");
  await prisma.organizationPool.delete({
    where: { organizationId_poolId: { organizationId, poolId } },
  });
  await logAudit({
    userId: admin.id,
    organizationId,
    action: "detach_pool",
    resourceType: "OrganizationPool",
    resourceId: `${organizationId}:${poolId}`,
    metadata: { poolId, organizationId },
  });
  revalidatePath(`/admin/pools/${poolId}`);
  revalidatePath(`/admin/organizations/${organizationId}`);
}
