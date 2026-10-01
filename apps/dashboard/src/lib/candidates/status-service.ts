import { prisma } from "@/lib/db";
import {
  DEFAULT_CANDIDATE_STATUS,
  type CandidateStatusValue,
  type StatusByCandidate,
} from "@/lib/candidates/status";

/** Mappa candidateId -> status per l'org (assenza = NEW). */
export async function getStatusByCandidateForOrg(
  organizationId: string,
): Promise<StatusByCandidate> {
  const rows = await prisma.candidateStatus.findMany({
    where: { organizationId },
    select: { candidateId: true, status: true },
  });
  const out: StatusByCandidate = {};
  for (const r of rows) out[r.candidateId] = r.status;
  return out;
}

export async function getCandidateStatusForOrg(
  organizationId: string,
  candidateId: string,
): Promise<CandidateStatusValue> {
  const row = await prisma.candidateStatus.findUnique({
    where: { candidateId_organizationId: { candidateId, organizationId } },
    select: { status: true },
  });
  return row?.status ?? DEFAULT_CANDIDATE_STATUS;
}

interface ChangeCandidateStatusParams {
  candidateId: string;
  organizationId: string;
  userId: string;
  status: CandidateStatusValue;
}

/**
 * Sets the org's status for a candidate and audits the transition.
 * Caller is responsible for checking the org can see the candidate.
 */
export async function changeCandidateStatus({
  candidateId,
  organizationId,
  userId,
  status,
}: ChangeCandidateStatusParams): Promise<{
  changed: boolean;
  from: CandidateStatusValue;
  to: CandidateStatusValue;
}> {
  return prisma.$transaction(async (tx) => {
    const key = { candidateId_organizationId: { candidateId, organizationId } };
    const existing = await tx.candidateStatus.findUnique({
      where: key,
      select: { status: true },
    });
    const from = existing?.status ?? DEFAULT_CANDIDATE_STATUS;
    if (from === status) return { changed: false, from, to: status };

    await tx.candidateStatus.upsert({
      where: key,
      create: { candidateId, organizationId, status, updatedByUserId: userId },
      update: { status, updatedByUserId: userId },
    });
    await tx.auditLog.create({
      data: {
        userId,
        organizationId,
        action: "candidate.status.change",
        resourceType: "candidate",
        resourceId: candidateId,
        metadata: { from, to: status },
      },
    });
    return { changed: true, from, to: status };
  });
}
