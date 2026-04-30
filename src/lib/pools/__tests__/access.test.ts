import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getAccessiblePoolIds, getAccessiblePools } from "@/lib/pools/access";

describe("getAccessiblePoolIds / getAccessiblePools", () => {
  beforeEach(async () => {
    await prisma.candidateNote.deleteMany({});
    await prisma.candidateTag.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.jobDescription.deleteMany({});
    await prisma.organizationPool.deleteMany({});
    await prisma.pool.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ADMIN_KUBRI sees every pool in the system", async () => {
    const p1 = await prisma.pool.create({ data: { name: "P1", slug: "p1" } });
    const p2 = await prisma.pool.create({ data: { name: "P2", slug: "p2" } });
    const org = await prisma.organization.create({
      data: { name: "Kubri", slug: "kubri" },
    });
    const admin = await prisma.user.create({
      data: { id: crypto.randomUUID(), email: "a@k", name: "Admin", role: "ADMIN_KUBRI", organizationId: org.id },
    });

    const ids = await getAccessiblePoolIds(admin.id);
    expect(new Set(ids)).toEqual(new Set([p1.id, p2.id]));
  });

  it("ORG_MEMBER sees only the pools attached to their org", async () => {
    const p1 = await prisma.pool.create({ data: { name: "P1", slug: "p1" } });
    const p2 = await prisma.pool.create({ data: { name: "P2", slug: "p2" } });
    const org = await prisma.organization.create({
      data: {
        name: "Org",
        slug: "org",
        pools: { create: [{ poolId: p1.id }] },
      },
    });
    const user = await prisma.user.create({
      data: { id: crypto.randomUUID(), email: "u@o", name: "User", role: "ORG_MEMBER", organizationId: org.id },
    });

    const ids = await getAccessiblePoolIds(user.id);
    expect(ids).toEqual([p1.id]);
    expect(ids).not.toContain(p2.id);
  });

  it("getAccessiblePools returns full Pool objects with externalKey", async () => {
    const p1 = await prisma.pool.create({
      data: { name: "P1", slug: "p1", externalKey: "ext-1" },
    });
    const org = await prisma.organization.create({
      data: {
        name: "Org",
        slug: "org",
        pools: { create: [{ poolId: p1.id }] },
      },
    });
    const user = await prisma.user.create({
      data: { id: crypto.randomUUID(), email: "u@o", name: "User", role: "ORG_MEMBER", organizationId: org.id },
    });

    const pools = await getAccessiblePools(user.id);
    expect(pools).toHaveLength(1);
    expect(pools[0].externalKey).toBe("ext-1");
  });
});
