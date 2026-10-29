import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { normalizePhone } from "./phone";

/** Last 8 digits of a phone number: robust to prefixes, spaces and dashes. */
export function phoneSuffix(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : null;
}

/**
 * Candidates in the same pool that may be the same person (same phone
 * suffix or same email). Advisory only — never blocks creation. Stored
 * phones with separators inside the last 8 digits won't match; acceptable
 * for a warning.
 */
export async function findPossibleDuplicates(
  poolId: string,
  probe: { phone: string | null; email: string | null },
): Promise<{ id: string; firstName: string | null; lastName: string | null }[]> {
  const or: Prisma.CandidateWhereInput[] = [];
  const suffix = phoneSuffix(probe.phone);
  if (suffix) or.push({ phone: { endsWith: suffix } });
  if (probe.email) or.push({ email: { equals: probe.email, mode: "insensitive" } });
  if (or.length === 0) return [];

  return prisma.candidate.findMany({
    where: { poolId, OR: or },
    select: { id: true, firstName: true, lastName: true },
    take: 5,
  });
}

/**
 * The candidate of `poolId` whose phone is the same number as `phone` after
 * normalization, or null. Used to attach a public-landing CV to an existing
 * profile instead of creating a duplicate — exact match only, same pool only
 * (never across pools: they may belong to different controllers). The SQL
 * filter narrows by the last 8 digits; stored phones with separators inside
 * those digits are missed (a duplicate is created — acceptable).
 */
export async function findCandidateIdBySamePhone(
  db: Prisma.TransactionClient,
  poolId: string,
  phone: string | null,
): Promise<string | null> {
  const target = normalizePhone(phone);
  if (!target) return null;
  const rows = await db.candidate.findMany({
    where: { poolId, phone: { endsWith: target.slice(-8) } },
    select: { id: true, phone: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return rows.find((r) => normalizePhone(r.phone) === target)?.id ?? null;
}
