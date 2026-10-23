import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { generateEmbedding, vectorToPgLiteral } from "@/lib/embeddings/client";
import { buildCandidateEmbeddingText } from "@/lib/embeddings/text";

const EMBEDDING_SOURCE_SELECT = {
  id: true,
  skillsAndCompetences: true,
  workExperience: true,
  educationAndTraining: true,
  desiredJob: true,
  jobConstraints: true,
} as const;

export type CandidateEmbeddingSource = Prisma.CandidateGetPayload<{
  select: typeof EMBEDDING_SOURCE_SELECT;
}>;

/**
 * Upsert a candidate on (poolId, externalId). The single write primitive for
 * every Candidate ingestion path (Make webhook, assessment webhook, dashboard
 * creation, backfills). Pass `db` to run inside a transaction.
 */
export async function upsertCandidate(
  data: Prisma.CandidateUncheckedCreateInput,
  db: Prisma.TransactionClient = prisma,
): Promise<CandidateEmbeddingSource> {
  return db.candidate.upsert({
    where: {
      poolId_externalId: { poolId: data.poolId, externalId: data.externalId },
    },
    create: data,
    update: data,
    select: EMBEDDING_SOURCE_SELECT,
  });
}

/**
 * Regenerate the candidate's embedding. Best-effort: on failure it logs and
 * leaves `embedding` null for the nightly cron to retry. Never throws.
 * Call it after any surrounding transaction has committed.
 */
export async function refreshCandidateEmbedding(
  candidate: CandidateEmbeddingSource,
  logTag: string,
): Promise<void> {
  const embeddingText = buildCandidateEmbeddingText({
    skillsAndCompetences: candidate.skillsAndCompetences,
    workExperience: candidate.workExperience,
    educationAndTraining: candidate.educationAndTraining,
    desiredJob: candidate.desiredJob,
    jobConstraints: candidate.jobConstraints,
  });
  if (embeddingText.length === 0) return;

  try {
    const vector = await generateEmbedding(embeddingText);
    await prisma.$executeRaw`
      UPDATE "Candidate"
      SET "embedding" = ${vectorToPgLiteral(vector)}::vector,
          "embeddingText" = ${embeddingText},
          "embeddingUpdatedAt" = now()
      WHERE id = ${candidate.id}::uuid
    `;
  } catch (e) {
    console.error(`[${logTag}] embedding failed`, {
      candidateId: candidate.id,
      error: e,
    });
  }
}

/** Upsert + embedding. Throws only if the upsert fails. */
export async function ingestCandidate(
  data: Prisma.CandidateUncheckedCreateInput,
  logTag: string,
): Promise<{ candidateId: string }> {
  const candidate = await upsertCandidate(data);
  await refreshCandidateEmbedding(candidate, logTag);
  return { candidateId: candidate.id };
}
