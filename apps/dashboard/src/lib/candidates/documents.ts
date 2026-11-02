import { prisma } from "@/lib/db";
import type { CandidateDocumentRow } from "@/components/candidates/candidate-documents";

interface RawDocument {
  id: string;
  fileName: string;
  createdAt: Date;
  storagePath: string;
  uploadedBy: { name: string | null } | null;
}

export function mapDocumentRows(
  docs: RawDocument[],
  landingPaths: ReadonlySet<string>,
): CandidateDocumentRow[] {
  return docs.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    createdAt: d.createdAt,
    uploadedByName: d.uploadedBy?.name ?? null,
    fromLanding: landingPaths.has(d.storagePath),
  }));
}

/** Storage paths of this candidate's CVs that were uploaded via the public landing. */
export async function getLandingStoragePaths(candidateId: string): Promise<Set<string>> {
  const imports = await prisma.candidateImport.findMany({
    where: { candidateId, origin: "PUBLIC_LINK" },
    select: { storagePath: true },
  });
  return new Set(imports.map((i) => i.storagePath));
}
