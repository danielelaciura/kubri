import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resolvePoolByExternalKey, UnknownPoolError } from "@/lib/pools/resolve";

// SKIPPED: see access.test.ts — deleteMany({}) on candidate/pool wipes dev data.
describe.skip("resolvePoolByExternalKey", () => {
  beforeEach(async () => {
    // Delete in FK-safe order: rows that reference Pool first.
    await prisma.candidateNote.deleteMany({});
    await prisma.candidate.deleteMany({});
    await prisma.organizationPool.deleteMany({});
    await prisma.pool.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns the pool when externalKey matches", async () => {
    const created = await prisma.pool.create({
      data: { name: "Test", slug: "test", externalKey: "ds-123" },
    });
    const found = await resolvePoolByExternalKey("ds-123");
    expect(found.id).toBe(created.id);
  });

  it("throws UnknownPoolError when no pool matches", async () => {
    await expect(resolvePoolByExternalKey("nope")).rejects.toBeInstanceOf(UnknownPoolError);
  });
});
