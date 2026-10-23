import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

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
