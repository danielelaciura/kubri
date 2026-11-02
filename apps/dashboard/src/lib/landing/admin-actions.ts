"use server";

import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { Role } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { saveLandingPage } from "@/lib/landing/service";
import { landingPageInputSchema } from "@/lib/validations/landing-page";
import type { SaveLandingState } from "@/lib/landing/admin-types";

export async function saveLandingPageAction(
  organizationId: string,
  _prev: SaveLandingState,
  formData: FormData,
): Promise<SaveLandingState> {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return { status: "error", error: "FORBIDDEN" };
  }
  if (user.role !== Role.ADMIN_KUBRI) return { status: "error", error: "FORBIDDEN" };

  if (!z.string().uuid().safeParse(organizationId).success) return { status: "error", error: "VALIDATION" };

  const parsed = landingPageInputSchema.safeParse({
    slug: formData.get("slug"),
    poolId: formData.get("poolId"),
    privacyPolicyUrl: formData.get("privacyPolicyUrl"),
    enabled: formData.get("enabled") === "on",
  });
  if (!parsed.success) return { status: "error", error: "VALIDATION" };

  const result = await saveLandingPage(organizationId, parsed.data);
  if (!result.ok) return { status: "error", error: result.error };

  await logAudit({
    userId: user.id,
    organizationId,
    action: "landing_page.save",
    resourceType: "CandidateLandingPage",
    resourceId: result.id,
    metadata: { slug: parsed.data.slug, poolId: parsed.data.poolId, enabled: parsed.data.enabled },
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
  return { status: "saved" };
}
