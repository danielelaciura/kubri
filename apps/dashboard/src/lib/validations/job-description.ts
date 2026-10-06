import { z } from "zod/v4";
import {
  DEFAULT_SEARCH_RADIUS_KM,
  MIN_RADIUS_KM,
  MAX_RADIUS_KM,
} from "@/lib/geo/constants";
import { normalizeJobName } from "@/lib/jobs/normalize-name";

export const jobDescriptionInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Il nome è obbligatorio")
    .max(120, "Massimo 120 caratteri")
    .transform(normalizeJobName),
  locationRaw: z.string().trim().min(1, "La località è obbligatoria").max(120),
  description: z
    .string()
    .trim()
    .min(20, "La descrizione deve contenere almeno 20 caratteri")
    .max(5000),
  skills: z
    .array(z.string())
    .max(30, "Massimo 30 competenze")
    .transform((arr) => arr.map((s) => s.trim()).filter(Boolean)),
  searchRadiusKm: z.coerce
    .number()
    .int()
    .min(MIN_RADIUS_KM, `Il raggio minimo è ${MIN_RADIUS_KM} km`)
    .max(MAX_RADIUS_KM, `Il raggio massimo è ${MAX_RADIUS_KM} km`)
    .default(DEFAULT_SEARCH_RADIUS_KM),
});

export type JobDescriptionInput = z.infer<typeof jobDescriptionInputSchema>;
