import { z } from "zod/v4";

/** 3–60 chars, lowercase letters, digits and inner dashes. */
export const LANDING_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export const LANDING_TITLE_MAX = 120;
export const LANDING_SUBTITLE_MAX = 300;
export const LANDING_TAGLINE_MAX = 60;

const landingTitle = z.string().trim().min(1).max(LANDING_TITLE_MAX);
/** Optional: blank means the page shows no intro line. */
const landingSubtitle = z
  .string()
  .trim()
  .max(LANDING_SUBTITLE_MAX)
  .transform((s) => s || null);

/** Optional line under the organization name ("Cooperativa sociale"). */
const landingTagline = z
  .string()
  .trim()
  .max(LANDING_TAGLINE_MAX)
  .transform((s) => s || null);

export const landingPageInputSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(LANDING_SLUG_RE),
  poolId: z.string().uuid(),
  // Optional: blank means the consent names Kubri's notice only.
  privacyPolicyUrl: z.union([
    z.literal("").transform(() => null),
    z.url().max(500).refine((u) => u.startsWith("https://")),
  ]),
  enabled: z.boolean(),
  titleIt: landingTitle,
  titleEn: landingTitle,
  subtitleIt: landingSubtitle,
  subtitleEn: landingSubtitle,
  taglineIt: landingTagline,
  taglineEn: landingTagline,
});

export type LandingPageInput = z.output<typeof landingPageInputSchema>;
