import { z } from "zod";
import { LocalizedTextSchema } from "../../i18n/localized-text";
import { ConditionSchema } from "./conditions";
import { IdSchema } from "./ids";

// A text is either inline or a reference to the campaign's `texts` map.
// The ref object comes first: a {ref} object is not a valid LocalizedText anyway.
export const TextValueSchema = z.union([z.strictObject({ ref: IdSchema }), LocalizedTextSchema]);
export type TextValue = z.infer<typeof TextValueSchema>;

export const SPECIAL_TARGETS = ["@stop", "@repeat", "@end"] as const;
export type SpecialTarget = (typeof SPECIAL_TARGETS)[number];

export const TargetSchema = z.union([z.enum(SPECIAL_TARGETS), IdSchema]);
export type Target = z.infer<typeof TargetSchema>;

export const TransitionSchema = z.union([
  TargetSchema,
  z.strictObject({ reply: IdSchema, then: TargetSchema }),
]);
export type Transition = z.infer<typeof TransitionSchema>;

const OnSchema = z.record(IdSchema, TransitionSchema).optional();

const stepBase = {
  id: IdSchema,
  when: ConditionSchema.optional(),
};

export const MessageStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("message"),
  text: TextValueSchema,
  on: OnSchema,
});

export const ChoiceOptionSchema = z.strictObject({
  id: IdSchema,
  /** Read by the LLM to classify the candidate's answer. */
  description: z.string().trim().min(1),
});

export const ChoiceStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("choice"),
  prompt: TextValueSchema,
  options: z.array(ChoiceOptionSchema).min(2),
  on: OnSchema,
});

export const ConsentStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("consent"),
  consentKey: IdSchema,
  textVersion: z.string().trim().min(1),
  text: TextValueSchema,
  link: z.url().optional(),
  optional: z.boolean().default(false),
  on: OnSchema,
});

export const QuestionSchema = z.strictObject({
  id: IdSchema,
  /** A standard field key or "custom.<key>". */
  field: z.string().min(1),
  prompt: TextValueSchema,
  required: z.boolean().default(true),
  /** Extraction guidance for the LLM, specific to this question. */
  hint: z.string().trim().min(1).optional(),
  when: ConditionSchema.optional(),
  terminateIf: ConditionSchema.optional(),
  maxClarifications: z.number().int().min(0).max(5).default(2),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuestionsStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("questions"),
  title: TextValueSchema.optional(),
  questions: z.array(QuestionSchema).min(1),
  on: OnSchema,
});

export const CvOfferStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("cv_offer"),
  prompt: TextValueSchema,
  on: OnSchema,
});

export const EndStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal("end"),
  text: TextValueSchema,
});

export const StepSchema = z.discriminatedUnion("type", [
  MessageStepSchema,
  ChoiceStepSchema,
  ConsentStepSchema,
  QuestionsStepSchema,
  CvOfferStepSchema,
  EndStepSchema,
]);
export type Step = z.infer<typeof StepSchema>;
export type StepType = Step["type"];
