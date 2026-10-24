import { createDatabase, type Database } from "../../../src/store/db";

export function testDatabaseUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL missing: is .env.test loaded?");
  return url;
}

export function createTestDatabase(): Database {
  return createDatabase(testDatabaseUrl());
}

// Empties every bot table except the migration history. Test-only raw SQL.
export async function resetBotSchema(db: Database): Promise<void> {
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'bot' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"bot"."${t.table_name}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}
