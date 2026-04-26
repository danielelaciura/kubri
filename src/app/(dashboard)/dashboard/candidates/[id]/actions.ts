"use server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { requireLocalCandidateId } from "@/lib/candidates/resolve";
import { z } from "zod/v4";
import { revalidatePath } from "next/cache";

const noteSchema = z.object({
  makeRecordId: z.string().min(1),
  content: z.string().min(1, "Il contenuto della nota non può essere vuoto"),
});

const tagSchema = z.object({
  makeRecordId: z.string().min(1),
  tag: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Il tag non può essere vuoto")),
});

export async function addNote(formData: FormData) {
  const session = await getCurrentUser();
  if (!session.organizationId) {
    throw new Error("Non autenticato");
  }

  const parsed = noteSchema.safeParse({
    makeRecordId: formData.get("makeRecordId"),
    content: formData.get("content"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi");
  }

  const { makeRecordId, content } = parsed.data;
  const { id: userId, organizationId } = session;
  const candidateId = await requireLocalCandidateId(
    organizationId,
    makeRecordId,
  );

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
    metadata: { makeRecordId, candidateId },
  });

  revalidatePath(`/dashboard/candidates/${makeRecordId}`);
}

export async function addTag(formData: FormData) {
  const session = await getCurrentUser();
  if (!session.organizationId) {
    throw new Error("Non autenticato");
  }

  const parsed = tagSchema.safeParse({
    makeRecordId: formData.get("makeRecordId"),
    tag: formData.get("tag"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dati non validi");
  }

  const { makeRecordId, tag } = parsed.data;
  const { id: userId, organizationId } = session;
  const candidateId = await requireLocalCandidateId(
    organizationId,
    makeRecordId,
  );

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
    metadata: { makeRecordId, candidateId, tag },
  });

  revalidatePath(`/dashboard/candidates/${makeRecordId}`);
}

export async function removeTag(tagId: string) {
  const session = await getCurrentUser();
  if (!session.organizationId) {
    throw new Error("Non autenticato");
  }

  const { id: userId, organizationId } = session;

  // Find the tag ensuring it belongs to the user's organization,
  // and pull along the candidate's externalId so we can revalidate.
  const tag = await prisma.candidateTag.findFirst({
    where: {
      id: tagId,
      organizationId,
    },
    include: {
      candidate: { select: { externalId: true } },
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

  revalidatePath(`/dashboard/candidates/${tag.candidate.externalId}`);
}
