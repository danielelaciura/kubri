"use server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
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

  const note = await prisma.candidateNote.create({
    data: {
      makeRecordId,
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
    metadata: { makeRecordId },
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

  // Check for duplicate tag within same record and organization
  const existing = await prisma.candidateTag.findFirst({
    where: {
      makeRecordId,
      organizationId,
      tag,
    },
  });

  if (existing) {
    throw new Error("Questo tag esiste già per questo candidato");
  }

  const candidateTag = await prisma.candidateTag.create({
    data: {
      makeRecordId,
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
    metadata: { makeRecordId, tag },
  });

  revalidatePath(`/dashboard/candidates/${makeRecordId}`);
}

export async function removeTag(tagId: string) {
  const session = await getCurrentUser();
  if (!session.organizationId) {
    throw new Error("Non autenticato");
  }

  const { id: userId, organizationId } = session;

  // Find the tag ensuring it belongs to the user's organization
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
    metadata: { makeRecordId: tag.makeRecordId, tag: tag.tag },
  });

  revalidatePath(`/dashboard/candidates/${tag.makeRecordId}`);
}
