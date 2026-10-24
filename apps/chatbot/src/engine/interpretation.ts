import { z } from "zod";
import { LanguageCodeSchema } from "../i18n/localized-text";

export const INTENTS = [
  "answer",
  "choice",
  "off_topic",
  "edit_request",
  "refusal",
  "help",
  "opt_out",
  "delete_data",
  "unclear",
] as const;
export type Intent = (typeof INTENTS)[number];

export const COMPLETENESS = ["complete", "partial", "absent"] as const;
export type Completeness = (typeof COMPLETENESS)[number];

const ConfidenceSchema = z.number().min(0).max(1);

/**
 * What nlu understood of one turn (spec §8.3). The engine owns this contract and nlu (plan 06)
 * produces it, so engine never imports from nlu. Patch values stay `unknown` here: they are
 * validated against the field types by `validatePatch` before touching the profile.
 */
export const InterpretationSchema = z.strictObject({
  language: z.strictObject({ code: LanguageCodeSchema, confidence: ConfidenceSchema }),
  intent: z.enum(INTENTS),
  /** For choice, consent and cv_offer steps, and for yes/no confirmations. */
  choice: z.string().min(1).optional(),
  patch: z.array(
    z.strictObject({
      field: z.string().min(1),
      value: z.unknown(),
      confidence: ConfidenceSchema,
      evidence: z.string(),
    }),
  ),
  currentQuestion: z.strictObject({
    completeness: z.enum(COMPLETENESS),
    missing: z.string().min(1).optional(),
  }),
  editTarget: z.strictObject({ field: z.string().min(1), newValue: z.unknown() }).optional(),
  offTopicReply: z.string().trim().min(1).optional(),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

/** True when the turn picked `choice` (an option id, "yes", "accepted", ...). */
export function isChoice(interpretation: Interpretation | null, choice: string): boolean {
  return interpretation?.intent === "choice" && interpretation.choice === choice;
}
