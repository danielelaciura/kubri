import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client";
import { toPgConnectionString } from "./connection-string";

export type Database = PrismaClient;

/** A transaction's client. A Database is assignable to it, so stores accept both. */
export type Tx = Prisma.TransactionClient;

export function createDatabase(databaseUrl: string): Database {
  const adapter = new PrismaPg({ connectionString: toPgConnectionString(databaseUrl) });
  return new PrismaClient({ adapter });
}

/** An interactive transaction. The turn holds one open for its whole duration (D102). */
export function inTransaction<T>(
  db: Database,
  fn: (tx: Tx) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return db.$transaction(fn, { timeout: timeoutMs, maxWait: 10_000 });
}

/**
 * Raw SQL is allowed in store for advisory locks (CLAUDE.md). Held until the transaction ends.
 * The cast to text is needed because Prisma cannot read the `void` the function returns.
 */
export async function lockKey(tx: Tx, key: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
}
