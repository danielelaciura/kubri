import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, resetBotSchema } from "./helpers/database";

const db = createTestDatabase();

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("shared database isolation", () => {
  it("creates bot tables in the bot schema only", async () => {
    const rows = await db.$queryRaw<{ table_schema: string }[]>`
      SELECT table_schema FROM information_schema.tables WHERE table_name = 'Organization'
    `;
    expect(rows.map((r) => r.table_schema)).toEqual(["bot"]);
  });

  it("records migrations in bot._prisma_migrations, never in the dashboard's table", async () => {
    const botRows = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM "bot"."_prisma_migrations" WHERE finished_at IS NOT NULL
    `;
    const publicRows = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM public."_prisma_migrations"
    `;
    expect(botRows[0]?.count).toBeGreaterThan(0n);
    expect(publicRows[0]?.count).toBe(0n);
  });

  it("leaves the dashboard tables in place", async () => {
    const rows = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'dashboard_sentinel'
    `;
    expect(rows).toHaveLength(1);
  });

  it("reads and writes an Organization", async () => {
    await db.organization.create({ data: { slug: "kubri", name: "Kubri S.r.l." } });

    const found = await db.organization.findUnique({ where: { slug: "kubri" } });

    expect(found?.name).toBe("Kubri S.r.l.");
  });
});
