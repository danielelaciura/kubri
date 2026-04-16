"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jobDescriptionInputSchema } from "@/lib/validations/job-description";
import {
  updateJobDescription,
  deleteJobDescription,
  JobNameAlreadyExistsError,
  JobNotFoundError,
} from "@/lib/jobs/service";
import { invalidateOrgCache } from "@/lib/make/service";

type ActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const session = await auth();
  if (
    !session?.user?.id ||
    !session.user.organizationId ||
    session.user.role !== "ORG_ADMIN"
  ) {
    return null;
  }
  return { userId: session.user.id, organizationId: session.user.organizationId };
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
  });
}

export async function updateJobAction(id: string, formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "Non autorizzato" };

  const parsed = parseInput(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dati non validi" };
  }

  try {
    await updateJobDescription({
      id,
      organizationId: ctx.organizationId,
      input: parsed.data,
    });
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
    if (e instanceof JobNameAlreadyExistsError) return { ok: false, error: e.message };
    if (e instanceof JobNotFoundError) return { ok: false, error: e.message };
    throw e;
  }

  revalidatePath(`/dashboard/jobs/${id}`);
  revalidatePath("/dashboard/jobs");
  redirect(`/dashboard/jobs/${id}`);
}

export async function deleteJobAction(id: string): Promise<ActionResult> {
  const ctx = await requireAdmin();
  if (!ctx) return { ok: false, error: "Non autorizzato" };

  try {
    await deleteJobDescription({ id, organizationId: ctx.organizationId });
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
    if (e instanceof JobNotFoundError) return { ok: false, error: e.message };
    throw e;
  }

  revalidatePath("/dashboard/jobs");
  redirect("/dashboard/jobs");
}

export async function refreshCandidatesForJob(): Promise<void> {
  const session = await auth();
  if (!session?.user?.organizationId) return;
  await invalidateOrgCache(session.user.organizationId);
  revalidatePath(`/dashboard/jobs`, "layout");
}
