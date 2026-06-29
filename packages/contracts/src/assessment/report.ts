import { z } from "zod/v4";

/** Fixed competence-domain taxonomy. The LLM assigns competences to these; it never invents domains. */
export const DOMAIN_IDS = [
  "cognitive",
  "relational",
  "organizational",
  "technical",
  "motivation",
] as const;

export type DomainId = (typeof DOMAIN_IDS)[number];

export const DOMAIN_LABELS: Record<DomainId, string> = {
  cognitive: "Stile di pensiero",
  relational: "Stile relazionale",
  organizational: "Approccio all'organizzazione",
  technical: "Competenze operative",
  motivation: "Motivatori e preferenze lavorative",
};

/** Short labels for the cluster-map nodes, where the full labels don't fit. */
export const DOMAIN_SHORT_LABELS: Record<DomainId, string> = {
  cognitive: "Pensiero",
  relational: "Relazionale",
  organizational: "Organizzazione",
  technical: "Operative",
  motivation: "Motivatori",
};

export const COMPETENCE_LEVELS = ["Base", "Buono", "Forte"] as const;
export type CompetenceLevel = (typeof COMPETENCE_LEVELS)[number];

export const assessmentReportSchema = z.object({
  intro: z.string().min(1),
  domains: z
    .array(
      z.object({
        id: z.enum(DOMAIN_IDS),
        competences: z
          .array(
            z.object({
              name: z.string().min(1),
              level: z.enum(COMPETENCE_LEVELS),
              note: z.string(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export type AssessmentReport = z.infer<typeof assessmentReportSchema>;
