import { z } from "zod/v4";

/** 3–60 chars, lowercase letters, digits and inner dashes. */
export const LANDING_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

export const landingPageInputSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(LANDING_SLUG_RE),
  poolId: z.string().uuid(),
  privacyPolicyUrl: z
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://")),
  enabled: z.boolean(),
});

export type LandingPageInput = z.output<typeof landingPageInputSchema>;
