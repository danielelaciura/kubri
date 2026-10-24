import { z } from "zod";
import { COMPLETENESS, INTENTS, InterpretationSchema } from "../../../src/engine/interpretation";

/** `{ field: value }` (confidence 0.95) or the full list of entries. */
const PatchSchema = z.union([
  z.array(
    z.strictObject({
      field: z.string(),
      value: z.unknown(),
      confidence: z.number().default(0.95),
      evidence: z.string().default(""),
    }),
  ),
  z.record(z.string(), z.unknown()).transform((values) =>
    Object.entries(values).map(([field, value]) => ({
      field,
      value,
      confidence: 0.95,
      evidence: "",
    })),
  ),
]);

/** The fake NLU: the interpretation is written in the scenario, with defaults for brevity. */
const NluSchema = z
  .strictObject({
    intent: z.enum(INTENTS).default("answer"),
    language: z
      .strictObject({ code: z.string(), confidence: z.number() })
      .default({ code: "it", confidence: 0.99 }),
    choice: z.string().optional(),
    patch: PatchSchema.default([]),
    completeness: z.enum(COMPLETENESS).default("absent"),
    missing: z.string().optional(),
    editTarget: z.strictObject({ field: z.string(), newValue: z.unknown() }).optional(),
    offTopicReply: z.string().optional(),
  })
  .transform(({ completeness, missing, ...rest }) => ({
    ...rest,
    currentQuestion: missing === undefined ? { completeness } : { completeness, missing },
  }))
  .pipe(InterpretationSchema);

const ExpectationSchema = z.strictObject({
  phase: z.enum(["language", "flow", "post_completion", "closed"]).optional(),
  step: z.string().nullable().optional(),
  question: z.string().nullable().optional(),
  consentsAccepted: z.boolean().optional(),
  /** Ids of the texts sent (describeTextRef), exact and ordered. */
  sent: z.array(z.string()).optional(),
  /** The other effects (describeEffect), exact and ordered. */
  effects: z.array(z.string()).optional(),
  /** Values of the listed fields only; null = absent or unresolved. */
  profile: z.record(z.string(), z.unknown()).optional(),
  /** Outcomes of the listed steps only. */
  outcomes: z.record(z.string(), z.string()).optional(),
});
export type Expectation = z.infer<typeof ExpectationSchema>;

const TurnSchema = z.union([
  z.strictObject({ start: z.literal(true), expect: ExpectationSchema }),
  /** No `nlu` = nlu unavailable (interpretation: null). */
  z.strictObject({ user: z.string(), nlu: NluSchema.optional(), expect: ExpectationSchema }),
]);

export const ScenarioSchema = z.strictObject({
  description: z.string().min(1),
  /** Path of the campaign JSON, relative to apps/chatbot. */
  campaign: z.string().min(1),
  turns: z.array(TurnSchema).min(1),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
