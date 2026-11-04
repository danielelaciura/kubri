import { prisma } from "@/lib/db";
import { Prisma, type GlobalSharingMode } from "@/generated/prisma/client";
import { LANDING_SLUG_RE, type LandingPageInput } from "@/lib/validations/landing-page";

export interface ActiveLanding {
  id: string;
  slug: string;
  /** The organization's own notice; null = the consent names Kubri's only. */
  privacyPolicyUrl: string | null;
  /** Headline, intro and the line under the org name (null = none) per UI language. */
  texts: Record<"it" | "en", { title: string; subtitle: string | null; tagline: string | null }>;
  /** Partner logo version (for cache busting), or null when there is no logo. */
  logoVersion: number | null;
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
 * disabled, or its pool is no longer linked to the organization. Checked on
 * every public request, not only on save. The Global pool is allowed: an
 * internal Kubri organization linked to it runs the Global landing.
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
      titleIt: true,
      titleEn: true,
      subtitleIt: true,
      subtitleEn: true,
      taglineIt: true,
      taglineEn: true,
      logoPath: true,
      updatedAt: true,
      organizationId: true,
      poolId: true,
      organization: { select: { id: true, name: true } },
      pool: { select: { id: true, isGlobal: true, globalSharing: true, externalKey: true, slug: true } },
    },
  });
  if (!row || !row.enabled) return null;

  const link = await prisma.organizationPool.findUnique({
    where: { organizationId_poolId: { organizationId: row.organizationId, poolId: row.poolId } },
    select: { poolId: true },
  });
  if (!link) return null;

  return {
    id: row.id,
    slug: row.slug,
    privacyPolicyUrl: row.privacyPolicyUrl,
    texts: {
      it: { title: row.titleIt, subtitle: row.subtitleIt, tagline: row.taglineIt },
      en: { title: row.titleEn, subtitle: row.subtitleEn, tagline: row.taglineEn },
    },
    logoVersion: row.logoPath ? row.updatedAt.getTime() : null,
    organization: row.organization,
    pool: row.pool,
  };
}

/** The organization's landing (any state), for the admin card and the QR page. */
export async function getLandingForOrg(organizationId: string) {
  return prisma.candidateLandingPage.findUnique({
    where: { organizationId },
    select: {
      id: true, slug: true, poolId: true, enabled: true, privacyPolicyUrl: true,
      titleIt: true, titleEn: true, subtitleIt: true, subtitleEn: true,
      taglineIt: true, taglineEn: true, logoPath: true, updatedAt: true,
    },
  });
}

/** Storage path of an enabled landing's logo, for the public logo route. */
export async function getLandingLogoPath(slug: string): Promise<string | null> {
  slug = slug.toLowerCase();
  if (!LANDING_SLUG_RE.test(slug)) return null;
  const row = await prisma.candidateLandingPage.findUnique({
    where: { slug },
    select: { enabled: true, logoPath: true },
  });
  return row?.enabled ? row.logoPath : null;
}

export type SaveLandingResult =
  | { ok: true; id: string }
  | { ok: false; error: "INVALID_POOL" | "SLUG_TAKEN" };

/**
 * Create or update the organization's landing. Callers enforce ADMIN_KUBRI
 * and validate with landingPageInputSchema. The pool must be linked to the
 * organization (the Global pool included). `logoPath`: a new stored logo,
 * null to clear it, undefined to leave it as it is.
 */
export async function saveLandingPage(
  organizationId: string,
  input: LandingPageInput,
  logoPath?: string | null,
): Promise<SaveLandingResult> {
  const link = await prisma.organizationPool.findUnique({
    where: { organizationId_poolId: { organizationId, poolId: input.poolId } },
    select: { poolId: true },
  });
  if (!link) return { ok: false, error: "INVALID_POOL" };

  try {
    const row = await prisma.candidateLandingPage.upsert({
      where: { organizationId },
      create: { organizationId, ...input, logoPath: logoPath ?? null },
      update: logoPath === undefined ? input : { ...input, logoPath },
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
