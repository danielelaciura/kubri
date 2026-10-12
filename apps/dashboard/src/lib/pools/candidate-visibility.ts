import type { Prisma } from "@/generated/prisma/client";

/**
 * Prisma `where` fragment for candidates an organization may see: candidates in
 * the org's own pools, plus — only when `includeShared` — any candidate flagged
 * `sharedWithGlobal` (consented, via the Kubri privacy notice, to be shared).
 *
 * `includeShared` must be true only for orgs attached to the Global pool. An
 * isolated org (private pools only) must never see shared candidates from
 * Global or from other clients' pools. Resolve it via
 * `getOrgCandidateVisibility` rather than computing it at call sites.
 *
 * `poolId: { in: [] }` matches nothing. Compose it into a scoped read by
 * spreading alongside other keys (top-level keys AND together):
 * `{ id, ...candidateVisibilityWhere(poolIds, includeShared) }`.
 *
 * Kept in its own module (no Prisma client import) so it is unit-testable
 * without a database connection.
 */
export function candidateVisibilityWhere(
  poolIds: string[],
  includeShared: boolean,
): Prisma.CandidateWhereInput {
  if (!includeShared) return { poolId: { in: poolIds } };
  return { OR: [{ poolId: { in: poolIds } }, { sharedWithGlobal: true }] };
}
