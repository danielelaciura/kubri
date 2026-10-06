"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { jobDescriptionInputSchema } from "@/lib/validations/job-description";
import { z } from "zod/v4";
import {
  getJobDescription,
  updateJobDescription,
  deleteJobDescription,
  JobNameAlreadyExistsError,
  JobNotFoundError,
} from "@/lib/jobs/service";
import { invalidateRerankCacheForJd } from "@/lib/llm/rerank";
import { getDictionary } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n/locale";

type ActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const me = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, role: true, organizationId: true },
  });
  if (
    !me?.organizationId ||
    (me.role !== "ORG_ADMIN" && me.role !== "ADMIN_KUBRI")
  ) {
    return null;
  }
  return { userId: me.id, organizationId: me.organizationId };
}

function parseInput(formData: FormData) {
  const rawSkills = formData.get("skills");
  let skills: unknown = [];
  try {
    skills = typeof rawSkills === "string" && rawSkills.length ? JSON.parse(rawSkills) : [];
  } catch {
    skills = [];
  }
  return jobDescriptionInputSchema.safeParse({
    name: formData.get("name"),
    locationRaw: formData.get("locationRaw"),
    description: formData.get("description"),
    skills,
    searchRadiusKm: formData.get("searchRadiusKm") ?? undefined,
  });
}

export async function updateJobAction(id: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "Non autorizzato" };

  const t = getDictionary(await getServerLocale());

  const parsed = parseInput(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t.common.invalidData };
  }

  try {
    await updateJobDescription({
      id,
      organizationId: ctx.organizationId,
      input: parsed.data,
    });
    await invalidateRerankCacheForJd(id);
    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        action: "update",
        resourceType: "JobDescription",
        resourceId: id,
      },
    });
  } catch (e) {
    if (e instanceof JobNameAlreadyExistsError) return { ok: false, error: t.jobs.uniqueNameError };
    if (e instanceof JobNotFoundError) return { ok: false, error: t.jobs.notFound };
    throw e;
  }

  revalidatePath(`/dashboard/jobs/${id}`);
  revalidatePath("/dashboard/jobs");
  redirect(`/dashboard/jobs/${id}`);
}

export async function deleteJobAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "Non autorizzato" };

  const t = getDictionary(await getServerLocale());

  try {
    await deleteJobDescription({ id, organizationId: ctx.organizationId });
    await invalidateRerankCacheForJd(id);
    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        action: "delete",
        resourceType: "JobDescription",
        resourceId: id,
      },
    });
  } catch (e) {
    if (e instanceof JobNotFoundError) return { ok: false, error: t.jobs.notFound };
    throw e;
  }

  revalidatePath("/dashboard/jobs");
  redirect("/dashboard/jobs");
}

export async function refreshCandidatesForJob(jdId: string): Promise<void> {
  if (!z.uuid().safeParse(jdId).success) return;
  const ctx = await requireAdmin();
  if (!ctx) return;
  const jd = await getJobDescription({ id: jdId, organizationId: ctx.organizationId });
  if (!jd) return;
  await invalidateRerankCacheForJd(jdId);
  revalidatePath(`/dashboard/jobs/${jdId}`);
  revalidatePath("/dashboard/jobs");
}
