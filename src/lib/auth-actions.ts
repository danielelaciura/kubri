"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Called once per session from a mounted client component in the dashboard layout.
 * Updates lastLoginAt and logs a single login_success audit entry.
 */
export async function trackLoginAction() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return;

  const dbUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { id: true, organizationId: true, lastLoginAt: true },
  });
  if (!dbUser) return;

  // Throttle: only record if last login is older than 5 minutes (dedupe refresh/nav).
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  if (dbUser.lastLoginAt && dbUser.lastLoginAt > fiveMinAgo) return;

  await prisma.user.update({
    where: { id: dbUser.id },
    data: { lastLoginAt: new Date() },
  });

  if (dbUser.organizationId) {
    await logAudit({
      userId: dbUser.id,
      organizationId: dbUser.organizationId,
      action: "login_success",
      resourceType: "User",
      resourceId: dbUser.id,
    });
  }
}
