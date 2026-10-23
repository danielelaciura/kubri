import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getOrgCandidateVisibility } from "@/lib/pools/access";
import { createDocumentSignedUrl } from "@/lib/storage/candidate-documents";

/** Download a candidate's document. Access-checked and audit-logged (GDPR). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  let user;
  try {
    user = await requireOrganization();
  } catch {
    return new Response(null, { status: 401 });
  }
  const { id, documentId } = await params;

  const candidateWhere =
    user.role === "ADMIN_KUBRI"
      ? { id }
      : { id, ...(await getOrgCandidateVisibility(user.organizationId)) };

  const doc = await prisma.candidateDocument.findFirst({
    where: { id: documentId, candidateId: id, candidate: candidateWhere },
    select: { id: true, storagePath: true, fileName: true },
  });
  if (!doc) return new Response(null, { status: 404 });

  await logAudit({
    userId: user.id,
    organizationId: user.organizationId,
    action: "candidate_document.download",
    resourceType: "candidate_document",
    resourceId: doc.id,
    metadata: { candidateId: id },
  });

  const url = await createDocumentSignedUrl(doc.storagePath, { downloadAs: doc.fileName });
  return NextResponse.redirect(url, 307);
}
