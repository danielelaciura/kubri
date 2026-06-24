import { prisma } from "@/lib/db";
import type { PoolModel as Pool } from "@/generated/prisma/models/Pool";

export class UnknownPoolError extends Error {
  constructor(public readonly externalKey: string) {
    super(`Unknown pool for externalKey: ${externalKey}`);
    this.name = "UnknownPoolError";
  }
}

export async function resolvePoolByExternalKey(externalKey: string): Promise<Pool> {
  const pool = await prisma.pool.findUnique({ where: { externalKey } });
  if (!pool) throw new UnknownPoolError(externalKey);
  return pool;
}
