"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { jobDescriptionInputSchema } from "@/lib/validations/job-description";
import { createJobDescription, JobNameAlreadyExistsError } from "@/lib/jobs/service";

type ActionResult = { ok: true; id: string } | { ok: false; error: string };

export async function createJobAction(formData: FormData): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { ok: false, error: "Non autorizzato" };

  const me = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, role: true, organizationId: true },
  });
  if (
    !me?.organizationId ||
    (me.role !== "ORG_ADMIN" && me.role !== "ADMIN_KUBRI")
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
      organizationId: me.organizationId,
      userId: me.id,
    });
    createdId = jd.id;
    await prisma.auditLog.create({
      data: {
        userId: me.id,
        organizationId: me.organizationId,
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
