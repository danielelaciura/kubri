"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jobDescriptionInputSchema } from "@/lib/validations/job-description";
import { createJobDescription, JobNameAlreadyExistsError } from "@/lib/jobs/service";

type ActionResult = { ok: true; id: string } | { ok: false; error: string };

export async function createJobAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (
    !session?.user?.id ||
    !session.user.organizationId ||
    (session.user.role !== "ORG_ADMIN" && session.user.role !== "ADMIN_KUBRI")
  ) {
    return { ok: false, error: "Non autorizzato" };
  }

  const rawSkills = formData.get("skills");
  let skills: unknown = [];
  try {
    skills = typeof rawSkills === "string" && rawSkills.length ? JSON.parse(rawSkills) : [];
  } catch {
    skills = [];
  }

  const parsed = jobDescriptionInputSchema.safeParse({
    name: formData.get("name"),
    locationRaw: formData.get("locationRaw"),
    description: formData.get("description"),
    skills,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dati non validi" };
  }

  let createdId: string;
  try {
    const jd = await createJobDescription({
      input: parsed.data,
      organizationId: session.user.organizationId,
      userId: session.user.id,
    });
    createdId = jd.id;
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        organizationId: session.user.organizationId,
        action: "create",
        resourceType: "JobDescription",
        resourceId: jd.id,
      },
    });
  } catch (e) {
    if (e instanceof JobNameAlreadyExistsError) return { ok: false, error: e.message };
    throw e;
  }

  revalidatePath("/dashboard/jobs");
  redirect(`/dashboard/jobs/${createdId}`);
}
