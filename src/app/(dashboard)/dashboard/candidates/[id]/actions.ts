"use server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getOrgAccessiblePoolIds } from "@/lib/pools/access";
import { candidateVisibilityWhere } from "@/lib/pools/candidate-visibility";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";

const noteSchema = z.object({
  candidateId: z.string().uuid(),
  content: z.string().min(1, "Il contenuto della nota non può essere vuoto"),
});

async function requireCandidateAccess(
  organizationId: string,
  candidateId: string,
  role: string,
): Promise<void> {
  if (role === "ADMIN_KUBRI") {
    const exists = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true },
    });
    if (!exists) {
      throw new Error("Candidato non accessibile");
    }
    return;
  }
  const poolIds = await getOrgAccessiblePoolIds(organizationId);
  const exists = await prisma.candidate.findFirst({
    where: { id: candidateId, ...candidateVisibilityWhere(poolIds) },
    select: { id: true },
  });
  if (!exists) {
    throw new Error("Candidato non accessibile");
  }
}

export async function addNote(formData: FormData) {
  const session = await getCurrentUser();
  if (!session.organizationId) {
    throw new Error("Non autenticato");
  }

  const t = getDictionary(await getServerLocale());

  const parsed = noteSchema.safeParse({
    candidateId: formData.get("candidateId"),
    content: formData.get("content"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? t.common.invalidData);
  }

  const { candidateId, content } = parsed.data;
  const { id: userId, organizationId } = session;
  await requireCandidateAccess(organizationId, candidateId, session.role);

  const note = await prisma.candidateNote.create({
    data: {
      candidateId,
      organizationId,
      userId,
      content,
    },
  });

  await logAudit({
    userId,
    organizationId,
    action: "note.create",
    resourceType: "candidate_note",
    resourceId: note.id,
    metadata: { candidateId },
  });

  revalidatePath(`/dashboard/candidates/${candidateId}`);
}

