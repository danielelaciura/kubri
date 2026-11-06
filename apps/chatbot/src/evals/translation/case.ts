import { z } from "zod";
import { LanguageCodeSchema } from "../../i18n/localized-text";

export const TRANSLATION_KINDS = ["system", "campaign", "label", "critical"] as const;

/** An Italian template to translate, with the placeholders the translation must keep (D70). */
export const TranslationCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
  tags: z.array(z.string().min(1)).default([]),
  /** The target language. */
  language: LanguageCodeSchema,
  kind: z.enum(TRANSLATION_KINDS),
  text: z.string().min(1),
});
export type TranslationCase = z.infer<typeof TranslationCaseSchema>;
