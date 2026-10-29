import { prisma } from "@/lib/db";
import { Prisma, type GlobalSharingMode } from "@/generated/prisma/client";
import { LANDING_SLUG_RE, type LandingPageInput } from "@/lib/validations/landing-page";

export interface ActiveLanding {
  id: string;
  slug: string;
  privacyPolicyUrl: string;
  organization: { id: string; name: string };
  pool: {
    id: string;
    isGlobal: boolean;
    globalSharing: GlobalSharingMode;
    externalKey: string | null;
    slug: string;
  };
}

/**
 * The landing behind /candidati/<slug>, or null (→ 404) when unknown,
 * disabled, pointing at a global pool, or its pool is no longer linked to the
 * organization. Checked on every public request, not only on save.
 */
export async function getActiveLandingBySlug(slug: string): Promise<ActiveLanding | null> {
  slug = slug.toLowerCase();
  if (!LANDING_SLUG_RE.test(slug)) return null;
  const row = await prisma.candidateLandingPage.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      enabled: true,
      privacyPolicyUrl: true,
      organizationId: true,
      poolId: true,
      organization: { select: { id: true, name: true } },
      pool: { select: { id: true, isGlobal: true, globalSharing: true, externalKey: true, slug: true } },
    },
  });
  if (!row || !row.enabled || row.pool.isGlobal) return null;

  const link = await prisma.organizationPool.findUnique({
    where: { organizationId_poolId: { organizationId: row.organizationId, poolId: row.poolId } },
    select: { poolId: true },
  });
  if (!link) return null;

  return {
    id: row.id,
    slug: row.slug,
    privacyPolicyUrl: row.privacyPolicyUrl,
    organization: row.organization,
    pool: row.pool,
  };
}

/** The organization's landing (any state), for the admin card and the QR page. */
export async function getLandingForOrg(organizationId: string) {
  return prisma.candidateLandingPage.findUnique({
    where: { organizationId },
    select: { id: true, slug: true, poolId: true, enabled: true, privacyPolicyUrl: true },
  });
}

export type SaveLandingResult =
  | { ok: true; id: string }
  | { ok: false; error: "INVALID_POOL" | "SLUG_TAKEN" };

/**
 * Create or update the organization's landing. Callers enforce ADMIN_KUBRI
 * and validate with landingPageInputSchema. The pool must be linked to the
 * organization and not global.
 */
export async function saveLandingPage(
  organizationId: string,
  input: LandingPageInput,
): Promise<SaveLandingResult> {
  const link = await prisma.organizationPool.findUnique({
    where: { organizationId_poolId: { organizationId, poolId: input.poolId } },
    select: { pool: { select: { isGlobal: true } } },
  });
  if (!link || link.pool.isGlobal) return { ok: false, error: "INVALID_POOL" };

  try {
    const row = await prisma.candidateLandingPage.upsert({
      where: { organizationId },
      create: { organizationId, ...input },
      update: input,
      select: { id: true },
    });
    return { ok: true, id: row.id };
  } catch (e) {
    // Only the slug can raise P2002: the upsert's where is the unique organizationId (ON CONFLICT on it).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "SLUG_TAKEN" };
    }
    throw e;
  }
}
