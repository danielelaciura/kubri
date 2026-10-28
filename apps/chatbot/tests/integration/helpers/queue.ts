import type { Database } from "../../../src/store/db";
import { toPgConnectionString } from "../../../src/store/connection-string";
import { createQueueRuntime, type QueueRuntime } from "../../../src/store/queue";
import { testDatabaseUrl } from "./database";

/**
 * The production schema name: the test database is a database of its own (kubri_bot_test), so
 * tests never touch a developer's queue, and they exercise the same schema the worker uses.
 */
export const TEST_QUEUE_SCHEMA = "bot_queue";

/** A pg-boss on the test database, retrying at once and only once so failures surface fast. */
export async function startTestQueue(): Promise<QueueRuntime> {
  const runtime = createQueueRuntime({
    connectionString: toPgConnectionString(testDatabaseUrl()),
    schema: TEST_QUEUE_SCHEMA,
    retryDelaySeconds: 0,
    retryLimit: 1,
  });
  await runtime.start();
  await runtime.purge();
  return runtime;
}

/** The jobs of a queue that could run now, read with SQL so nothing is consumed. */
export async function peekQueue(
  db: Database,
  name: string,
): Promise<{ id: string; data: unknown }[]> {
  return db.$queryRawUnsafe(
    `SELECT id::text AS id, data FROM ${TEST_QUEUE_SCHEMA}.job
     WHERE name = $1 AND state IN ('created', 'retry') AND start_after <= now()
     ORDER BY created_on`,
    name,
  );
}

/** Every job of a queue, delayed ones included. */
export async function countJobs(db: Database, name: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM ${TEST_QUEUE_SCHEMA}.job WHERE name = $1`,
    name,
  );
  return rows[0]?.n ?? 0;
}
