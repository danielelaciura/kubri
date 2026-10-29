import { z } from "zod";

export const DEFAULT_LANGUAGE = "it";

export const LanguageCodeSchema = z.string().regex(/^[a-z]{2}$/, "ISO 639-1 lowercase code");
export type LanguageCode = z.infer<typeof LanguageCodeSchema>;

// Italian is the reference language (spec §9); other keys are optional curated translations.
export const LocalizedTextSchema = z
  .record(LanguageCodeSchema, z.string().trim().min(1))
  .refine((text) => typeof text[DEFAULT_LANGUAGE] === "string", {
    error: "Italian (it) text is required",
  });
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;
