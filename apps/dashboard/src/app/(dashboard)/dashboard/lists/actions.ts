"use server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getOrgAccessiblePoolIds } from "@/lib/pools/access";
import { candidateVisibilityWhere } from "@/lib/pools/candidate-visibility";
import {
  createListSchema,
  renameListSchema,
  listMembershipSchema,
} from "@/lib/validations/list";
import { revalidatePath } from "next/cache";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";

async function requireSession() {
  const session = await getCurrentUser();
  if (!session.organizationId) throw new Error("Non autenticato");
  return session as typeof session & { organizationId: string };
}

async function requireCandidateAccessibleToOrg(
  organizationId: string,
  candidateId: string,
  role: string,
): Promise<void> {
  if (role === "ADMIN_KUBRI") {
    const exists = await prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true },
    });
    if (!exists) throw new Error("Candidato non accessibile");
    return;
  }
  const poolIds = await getOrgAccessiblePoolIds(organizationId);
  const exists = await prisma.candidate.findFirst({
    where: { id: candidateId, ...candidateVisibilityWhere(poolIds) },
    select: { id: true },
  });
  if (!exists) throw new Error("Candidato non accessibile");
}

async function requireListInOrg(organizationId: string, listId: string) {
  const list = await prisma.candidateList.findFirst({
    where: { id: listId, organizationId },
    select: { id: true },
  });
  if (!list) throw new Error("Lista non trovata");
  return list;
}

export async function createList(formData: FormData) {
  const session = await requireSession();
  const t = getDictionary(await getServerLocale());
  const parsed = createListSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? t.common.invalidData);
  }
  const { name } = parsed.data;
  const { id: userId, organizationId } = session;

  const dup = await prisma.candidateList.findFirst({
    where: { organizationId, name },
    select: { id: true },
  });
  if (dup) throw new Error(t.lists.duplicateName);

  const list = await prisma.candidateList.create({
    data: { organizationId, name, createdByUserId: userId },
  });
  await logAudit({
    userId,
    organizationId,
    action: "list.create",
    resourceType: "candidate_list",
    resourceId: list.id,
    metadata: { name },
  });
  revalidatePath("/dashboard/lists");
  return { id: list.id, name: list.name };
}

export async function renameList(formData: FormData) {
  const session = await requireSession();
  const t = getDictionary(await getServerLocale());
  const parsed = renameListSchema.safeParse({
    listId: formData.get("listId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? t.common.invalidData);
  }
  const { listId, name } = parsed.data;
  const { id: userId, organizationId } = session;
  await requireListInOrg(organizationId, listId);

  const dup = await prisma.candidateList.findFirst({
    where: { organizationId, name, id: { not: listId } },
    select: { id: true },
  });
  if (dup) throw new Error(t.lists.duplicateName);

  await prisma.candidateList.update({ where: { id: listId }, data: { name } });
  await logAudit({
    userId,
    organizationId,
    action: "list.rename",
    resourceType: "candidate_list",
    resourceId: listId,
    metadata: { name },
  });
  revalidatePath("/dashboard/lists");
  revalidatePath(`/dashboard/lists/${listId}`);
}

export async function deleteList(listId: string) {
  const session = await requireSession();
  const { id: userId, organizationId } = session;
  await requireListInOrg(organizationId, listId);

  await prisma.candidateList.delete({ where: { id: listId } });
  await logAudit({
    userId,
    organizationId,
    action: "list.delete",
    resourceType: "candidate_list",
    resourceId: listId,
  });
  revalidatePath("/dashboard/lists");
}

export async function addCandidateToList(listId: string, candidateId: string) {
  const session = await requireSession();
  const t = getDictionary(await getServerLocale());
  const parsed = listMembershipSchema.safeParse({ listId, candidateId });
  if (!parsed.success) throw new Error(t.common.invalidData);
  const { id: userId, organizationId, role } = session;

  await requireListInOrg(organizationId, listId);
  await requireCandidateAccessibleToOrg(organizationId, candidateId, role);

  await prisma.candidateListMembership.upsert({
    where: { listId_candidateId: { listId, candidateId } },
    create: { listId, candidateId, addedByUserId: userId },
    update: {},
  });
  await logAudit({
    userId,
    organizationId,
    action: "list.member.add",
    resourceType: "candidate_list",
    resourceId: listId,
    metadata: { candidateId },
  });
  revalidatePath("/dashboard/candidates");
  revalidatePath(`/dashboard/lists/${listId}`);
}

export async function removeCandidateFromList(
  listId: string,
  candidateId: string,
) {
  const session = await requireSession();
  const t = getDictionary(await getServerLocale());
  const parsed = listMembershipSchema.safeParse({ listId, candidateId });
  if (!parsed.success) throw new Error(t.common.invalidData);
  const { id: userId, organizationId } = session;

  await requireListInOrg(organizationId, listId);
  await prisma.candidateListMembership.deleteMany({
    where: { listId, candidateId },
  });
  await logAudit({
    userId,
    organizationId,
    action: "list.member.remove",
    resourceType: "candidate_list",
    resourceId: listId,
    metadata: { candidateId },
  });
  revalidatePath("/dashboard/candidates");
  revalidatePath(`/dashboard/lists/${listId}`);
}
