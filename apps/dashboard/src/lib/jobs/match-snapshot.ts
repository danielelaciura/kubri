import { prisma } from "@/lib/db";

export interface JobMatchSnapshotEntry {
  candidateId: string;
  llmScore: number;
}

/**
 * Replace the stored AI evaluation of a JD with a fresh one: delete every
 * existing row of the JD, then insert `entries`, atomically. An empty
 * `entries` clears the snapshot (no candidate reached the AI evaluation).
 */
export async function replaceJobMatchSnapshot(params: {
  jobDescriptionId: string;
  organizationId: string;
  entries: JobMatchSnapshotEntry[];
}): Promise<void> {
  const { jobDescriptionId, organizationId, entries } = params;
  const remove = prisma.jobMatch.deleteMany({ where: { jobDescriptionId, organizationId } });
  if (entries.length === 0) {
    await prisma.$transaction([remove]);
    return;
  }
  await prisma.$transaction([
    remove,
    prisma.jobMatch.createMany({
      data: entries.map((e) => ({
        jobDescriptionId,
        organizationId,
        candidateId: e.candidateId,
        llmScore: e.llmScore,
      })),
    }),
  ]);
}
