"use server";

import { z } from "zod/v4";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { Role } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { saveLandingPage } from "@/lib/landing/service";
import { processLandingLogo, removeLandingLogo, storeLandingLogo } from "@/lib/landing/logo";
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
    privacyPolicyUrl: String(formData.get("privacyPolicyUrl") ?? "").trim(),
    enabled: formData.get("enabled") === "on",
    titleIt: formData.get("titleIt"),
    titleEn: formData.get("titleEn"),
    subtitleIt: formData.get("subtitleIt") ?? "",
    subtitleEn: formData.get("subtitleEn") ?? "",
    brandName: formData.get("brandName"),
    taglineIt: formData.get("taglineIt") ?? "",
    taglineEn: formData.get("taglineEn") ?? "",
  });
  if (!parsed.success) return { status: "error", error: "VALIDATION" };

  // Logo: a chosen file replaces it, the checkbox clears it, otherwise unchanged.
  const file = formData.get("logo");
  const removeLogo = formData.get("removeLogo") === "on";
  let logoPath: string | null | undefined;
  if (file instanceof File && file.size > 0) {
    const logo = await processLandingLogo(new Uint8Array(await file.arrayBuffer()));
    if (!logo.ok) return { status: "error", error: logo.error };
    try {
      logoPath = await storeLandingLogo(organizationId, logo.png);
    } catch (e) {
      console.error("[landing admin] logo upload failed", e);
      return { status: "error", error: "LOGO_UPLOAD" };
    }
  } else if (removeLogo) {
    logoPath = null;
  }

  const result = await saveLandingPage(organizationId, parsed.data, logoPath);
  if (!result.ok) return { status: "error", error: result.error };
  if (logoPath === null) {
    // Best effort: the row no longer points at the file either way.
    await removeLandingLogo(organizationId).catch((e) => console.error("[landing admin] logo removal failed", e));
  }

  await logAudit({
    userId: user.id,
    organizationId,
    action: "landing_page.save",
    resourceType: "CandidateLandingPage",
    resourceId: result.id,
    metadata: {
      slug: parsed.data.slug, poolId: parsed.data.poolId, enabled: parsed.data.enabled,
      logo: logoPath === undefined ? "unchanged" : logoPath ? "replaced" : "removed",
    },
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
  return { status: "saved" };
}
