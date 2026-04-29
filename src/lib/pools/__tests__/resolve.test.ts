import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resolvePoolByExternalKey, UnknownPoolError } from "@/lib/pools/resolve";

describe("resolvePoolByExternalKey", () => {
  beforeEach(async () => {
    await prisma.pool.deleteMany({});
  });

  afterAll(async () => {
    await prisma.pool.deleteMany({});
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
