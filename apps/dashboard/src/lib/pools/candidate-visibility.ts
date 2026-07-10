import type { Prisma } from "@/generated/prisma/client";

/**
 * Prisma `where` fragment for candidates an organization may see: candidates in
 * the org's own pools OR any candidate flagged `sharedWithGlobal` (consented,
 * via the Kubri privacy notice, to be shared with all client organizations).
 *
 * `poolId: { in: [] }` matches nothing, so this stays correct even when the org
 * has no pools — globally-shared candidates still surface. Compose it into a
 * scoped read by spreading alongside other keys (top-level keys AND together):
 * `{ id, ...candidateVisibilityWhere(poolIds) }`.
 *
 * Kept in its own module (no Prisma client import) so it is unit-testable
 * without a database connection.
 */
export function candidateVisibilityWhere(
  poolIds: string[],
): Prisma.CandidateWhereInput {
  return { OR: [{ poolId: { in: poolIds } }, { sharedWithGlobal: true }] };
}
