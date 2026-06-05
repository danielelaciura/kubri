import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  getAccessiblePoolIds,
  getAccessiblePools,
  getOrgAccessiblePoolIds,
  getOrgAccessiblePools,
} from "@/lib/pools/access";

// SKIPPED: this test suite uses deleteMany({}) on user/organization/etc
// against the dev DB and wipes real data. Re-enable only when we have an
// isolated test DB (pglite or TEST_DATABASE_URL). See docs/superpowers/specs/2026-04-27-pools-design.md §11.
describe.skip("getAccessiblePoolIds / getAccessiblePools", () => {
  beforeEach(async () => {
    await prisma.candidateNote.deleteMany({});
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

  it("getOrgAccessiblePoolIds returns only the pools attached to the org (no admin bypass)", async () => {
    const p1 = await prisma.pool.create({ data: { name: "P1", slug: "p1" } });
    const p2 = await prisma.pool.create({ data: { name: "P2", slug: "p2" } });
    const org = await prisma.organization.create({
      data: {
        name: "Org",
        slug: "org",
        pools: { create: [{ poolId: p1.id }] },
      },
    });

    const ids = await getOrgAccessiblePoolIds(org.id);
    expect(ids).toEqual([p1.id]);
    expect(ids).not.toContain(p2.id);
  });

  it("getOrgAccessiblePools returns full Pool objects for the org", async () => {
    const p1 = await prisma.pool.create({
      data: { name: "P1", slug: "p1", externalKey: "ext-org-1" },
    });
    const org = await prisma.organization.create({
      data: {
        name: "Org",
        slug: "org",
        pools: { create: [{ poolId: p1.id }] },
      },
    });

    const pools = await getOrgAccessiblePools(org.id);
    expect(pools).toHaveLength(1);
    expect(pools[0]!.externalKey).toBe("ext-org-1");
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
    expect(pools[0]!.externalKey).toBe("ext-1");
  });
});
