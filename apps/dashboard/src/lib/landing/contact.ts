import { z } from "zod/v4";
import {
  candidateDraftSchema,
  candidateFieldsSchema,
  emptyCandidateDraftFields,
  isArrayFieldKey,
  type CandidateDraftFields,
  type CandidateFieldKey,
  type CandidateFields,
} from "@kubri/contracts";
import { normalizePhone } from "@/lib/candidates/phone";

/** What the candidate confirms on the landing (decision: minimal confirmation). */
export const landingContactSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine((p) => normalizePhone(p) !== null),
  email: z
    .string()
    .trim()
    .max(254)
    .transform((s) => (s ? s.toLowerCase() : null))
    .pipe(z.email().nullable()),
  privacyAccepted: z.literal(true),
  shareWithGlobal: z.boolean(),
});
export type LandingContact = z.output<typeof landingContactSchema>;

/** Pre-fill values for the confirmation form. */
export interface ContactPrefill {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

function draftFields(draft: unknown): CandidateDraftFields {
  const parsed = candidateDraftSchema.safeParse(draft);
  if (parsed.success) return parsed.data.fields;
  if (draft != null) {
    console.warn("[landing] stored draft does not match schema; using empty fields");
  }
  return emptyCandidateDraftFields();
}

export function contactFromDraft(draft: unknown): ContactPrefill {
  const f = draftFields(draft);
  return {
    firstName: f.firstName ?? "",
    lastName: f.lastName ?? "",
    phone: f.phone ?? "",
    email: f.email ?? "",
  };
}

/**
 * Full candidate fields: the LLM draft, with the four contact fields replaced
 * by what the candidate confirmed. Draft values the strict schema rejects are
 * cleared rather than failing the confirmation (the candidate cannot fix them).
 */
export function mergeContactIntoDraft(draft: unknown, contact: LandingContact): CandidateFields {
  const merged: Record<string, unknown> = {
    ...draftFields(draft),
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    email: contact.email,
  };
  const parsed = candidateFieldsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;

  // Defensive and currently unreachable: the draft and strict schemas share
  // limits. If it ever clears firstName/lastName, the final parse throws
  // (fail closed).
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && key in merged) {
      merged[key] = isArrayFieldKey(key as CandidateFieldKey) ? [] : null;
    }
  }
  return candidateFieldsSchema.parse(merged);
}
