import { z } from "zod/v4";

/** 3–60 chars, lowercase letters, digits and inner dashes. */
export const LANDING_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export const LANDING_TITLE_MAX = 120;
export const LANDING_SUBTITLE_MAX = 300;

const landingTitle = z.string().trim().min(1).max(LANDING_TITLE_MAX);
/** Optional: blank means the page shows no intro line. */
const landingSubtitle = z
  .string()
  .trim()
  .max(LANDING_SUBTITLE_MAX)
  .transform((s) => s || null);

export const landingPageInputSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(LANDING_SLUG_RE),
  poolId: z.string().uuid(),
  privacyPolicyUrl: z
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://")),
  enabled: z.boolean(),
  titleIt: landingTitle,
  titleEn: landingTitle,
  subtitleIt: landingSubtitle,
  subtitleEn: landingSubtitle,
});

export type LandingPageInput = z.output<typeof landingPageInputSchema>;
