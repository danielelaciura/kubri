import type { Database } from "./db";

/** For /health: resolves when the database answers, rejects otherwise. Raw SQL stays in store. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
