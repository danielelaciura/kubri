"use server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getOrgAccessiblePoolIds } from "@/lib/pools/access";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";

const noteSchema = z.object({
  candidateId: z.string().uuid(),
  content: z.string().min(1, "Il contenuto della nota non può essere vuoto"),
});

const tagSchema = z.object({
  candidateId: z.string().uuid(),
  tag: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Il tag non può essere vuoto")),
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
  if (poolIds.length === 0) {
    throw new Error("Candidato non accessibile");
  }
  const exists = await prisma.candidate.findFirst({
    where: { id: candidateId, poolId: { in: poolIds } },
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

  const parsed = noteSchema.safeParse({
    candidateId: formData.get("candidateId"),
    content: formData.get("content"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi");
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

export async function addTag(formData: FormData) {
  const session = await getCurrentUser();
  if (!session.organizationId) {
    throw new Error("Non autenticato");
  }

  const parsed = tagSchema.safeParse({
    candidateId: formData.get("candidateId"),
    tag: formData.get("tag"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi");
  }

  const { candidateId, tag } = parsed.data;
  const { id: userId, organizationId } = session;
  await requireCandidateAccess(organizationId, candidateId, session.role);

  // Check for duplicate tag within same candidate and organization
  const existing = await prisma.candidateTag.findFirst({
    where: {
      candidateId,
      organizationId,
      tag,
    },
  });

  if (existing) {
    throw new Error("Questo tag esiste già per questo candidato");
  }

  const candidateTag = await prisma.candidateTag.create({
    data: {
      candidateId,
      organizationId,
      tag,
    },
  });

  await logAudit({
    userId,
    organizationId,
    action: "tag.create",
    resourceType: "candidate_tag",
    resourceId: candidateTag.id,
    metadata: { candidateId, tag },
  });

  revalidatePath(`/dashboard/candidates/${candidateId}`);
}

export async function removeTag(tagId: string) {
  const session = await getCurrentUser();
  if (!session.organizationId) {
    throw new Error("Non autenticato");
  }

  const { id: userId, organizationId } = session;

  const tag = await prisma.candidateTag.findFirst({
    where: {
      id: tagId,
      organizationId,
    },
  });

  if (!tag) {
    throw new Error("Tag non trovato");
  }

  await prisma.candidateTag.delete({
    where: { id: tagId },
  });

  await logAudit({
    userId,
    organizationId,
    action: "tag.delete",
    resourceType: "candidate_tag",
    resourceId: tagId,
    metadata: { candidateId: tag.candidateId, tag: tag.tag },
  });

  revalidatePath(`/dashboard/candidates/${tag.candidateId}`);
}
