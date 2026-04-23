import { z } from "zod/v4";

export const jobDescriptionInputSchema = z.object({
  name: z.string().trim().min(1, "Il nome è obbligatorio").max(120, "Massimo 120 caratteri"),
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
});

export type JobDescriptionInput = z.infer<typeof jobDescriptionInputSchema>;
