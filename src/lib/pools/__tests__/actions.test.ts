import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

// Mock auth guard so we don't need a Supabase session.
const adminUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@kubri.test",
  name: "Test Admin",
  role: "ADMIN_KUBRI" as const,
  organizationId: null,
};

vi.mock("@/lib/auth-utils", () => ({
  requireRole: vi.fn(async () => adminUser),
}));

// next/cache is a no-op outside the Next runtime.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  createPool,
  updatePool,
  deletePool,
  attachOrgToPool,
  detachOrgFromPool,
} from "@/lib/pools/actions";

async function cleanup() {
  await prisma.candidateNote.deleteMany({});
  await prisma.candidate.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.jobDescription.deleteMany({});
  await prisma.organizationPool.deleteMany({});
  await prisma.pool.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organization.deleteMany({});
}

// SKIPPED: see access.test.ts — deleteMany({}) wipes the dev DB.
describe.skip("pool actions", () => {
  beforeEach(async () => {
    await cleanup();
    // The admin user must exist as a real DB row because logAudit FKs userId.
    await prisma.user.create({
      data: {
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        role: "ADMIN_KUBRI",
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe("createPool", () => {
    it("creates a pool and writes an audit log entry", async () => {
      const pool = await createPool({
        name: "Acme",
        slug: "acme",
        externalKey: "acme-key",
      });

      expect(pool.name).toBe("Acme");
      expect(pool.slug).toBe("acme");
      expect(pool.externalKey).toBe("acme-key");

      const persisted = await prisma.pool.findUnique({ where: { id: pool.id } });
      expect(persisted).not.toBeNull();

      const auditLogs = await prisma.auditLog.findMany({
        where: { resourceType: "Pool", resourceId: pool.id },
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]!.action).toBe("create_pool");
      expect(auditLogs[0]!.userId).toBe(adminUser.id);
      expect(auditLogs[0]!.organizationId).toBeNull();
    });

    it("rejects an invalid slug", async () => {
      await expect(
        createPool({ name: "Bad", slug: "Bad Slug!" }),
      ).rejects.toThrow();
    });
  });

  describe("updatePool", () => {
    it("updates name and writes an audit log entry", async () => {
      const pool = await prisma.pool.create({
        data: { name: "Old", slug: "old" },
      });

      const updated = await updatePool(pool.id, { name: "New" });
      expect(updated.name).toBe("New");

      const audit = await prisma.auditLog.findFirst({
        where: { action: "update_pool", resourceId: pool.id },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe("deletePool", () => {
    it("rejects when pool.isGlobal is true", async () => {
      const globalPool = await prisma.pool.create({
        data: { name: "Global", slug: "global", isGlobal: true },
      });

      await expect(deletePool(globalPool.id)).rejects.toThrow(
        /non può essere eliminato/,
      );

      // Pool still present.
      const stillThere = await prisma.pool.findUnique({
        where: { id: globalPool.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("rejects when the pool is attached to an organization (Prisma RESTRICT)", async () => {
      const pool = await prisma.pool.create({
        data: { name: "Attached", slug: "attached" },
      });
      const org = await prisma.organization.create({
        data: { name: "Org", slug: "org" },
      });
      await prisma.organizationPool.create({
        data: { poolId: pool.id, organizationId: org.id },
      });

      await expect(deletePool(pool.id)).rejects.toThrow();

      const stillThere = await prisma.pool.findUnique({ where: { id: pool.id } });
      expect(stillThere).not.toBeNull();
    });

    it("deletes a non-global, unattached pool and audit-logs", async () => {
      const pool = await prisma.pool.create({
        data: { name: "Free", slug: "free" },
      });

      await deletePool(pool.id);

      const gone = await prisma.pool.findUnique({ where: { id: pool.id } });
      expect(gone).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { action: "delete_pool", resourceId: pool.id },
      });
      expect(audit).not.toBeNull();
    });

    it("rejects when pool not found", async () => {
      await expect(
        deletePool("00000000-0000-0000-0000-0000000000ff"),
      ).rejects.toThrow(/non trovato/);
    });
  });

  describe("attachOrgToPool", () => {
    it("creates the OrganizationPool pivot row and audit-logs with the org id", async () => {
      const pool = await prisma.pool.create({
        data: { name: "P", slug: "p" },
      });
      const org = await prisma.organization.create({
        data: { name: "Org", slug: "org" },
      });

      await attachOrgToPool(pool.id, org.id);

      const pivot = await prisma.organizationPool.findUnique({
        where: {
          organizationId_poolId: { organizationId: org.id, poolId: pool.id },
        },
      });
      expect(pivot).not.toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { action: "attach_pool", resourceType: "OrganizationPool" },
      });
      expect(audit).not.toBeNull();
      expect(audit!.organizationId).toBe(org.id);
    });

    it("throws when the pivot already exists (no silent dedupe)", async () => {
      const pool = await prisma.pool.create({
        data: { name: "P", slug: "p" },
      });
      const org = await prisma.organization.create({
        data: { name: "Org", slug: "org" },
      });
      await prisma.organizationPool.create({
        data: { poolId: pool.id, organizationId: org.id },
      });

      await expect(attachOrgToPool(pool.id, org.id)).rejects.toThrow();
    });
  });

  describe("detachOrgFromPool", () => {
    it("removes the pivot row and audit-logs", async () => {
      const pool = await prisma.pool.create({
        data: { name: "P", slug: "p" },
      });
      const org = await prisma.organization.create({
        data: { name: "Org", slug: "org" },
      });
      await prisma.organizationPool.create({
        data: { poolId: pool.id, organizationId: org.id },
      });

      await detachOrgFromPool(pool.id, org.id);

      const pivot = await prisma.organizationPool.findUnique({
        where: {
          organizationId_poolId: { organizationId: org.id, poolId: pool.id },
        },
      });
      expect(pivot).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { action: "detach_pool", resourceType: "OrganizationPool" },
      });
      expect(audit).not.toBeNull();
      expect(audit!.organizationId).toBe(org.id);
    });
  });
});
