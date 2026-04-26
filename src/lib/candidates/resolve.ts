import { prisma } from "@/lib/db";

/**
 * Look up the local Candidate.id (UUID) for a candidate identified by its
 * Make external id, scoped to the user's organization. Returns null when no
 * Candidate row has been synced yet (page-render path: render gracefully).
 */
export async function findLocalCandidateId(
  organizationId: string,
  externalId: string,
): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { makeDatastoreId: true },
  });
  if (!org) return null;

  const candidate = await prisma.candidate.findUnique({
    where: {
      makeDatastoreId_externalId: {
        makeDatastoreId: org.makeDatastoreId,
        externalId,
      },
    },
    select: { id: true },
  });
  return candidate?.id ?? null;
}

/**
 * Same as findLocalCandidateId but throws when the Candidate row hasn't
 * been synced yet. Use from server actions (write path) — the user will see
 * the error message.
 */
export async function requireLocalCandidateId(
  organizationId: string,
  externalId: string,
): Promise<string> {
  const id = await findLocalCandidateId(organizationId, externalId);
  if (!id) {
    throw new Error(
      "Candidato non ancora sincronizzato. Riprova tra qualche minuto.",
    );
  }
  return id;
}
