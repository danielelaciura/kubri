import { z } from "zod";
import type { CampaignDefinition } from "../campaigns/schema/campaign";
import { COMPLETENESS, INTENTS } from "../engine/interpretation";
import type { FieldState, ProfileSnapshot } from "../engine/profile-snapshot";
import { initialSessionState, type PendingConfirmation, type SessionState } from "../engine/state";
import { LanguageCodeSchema } from "../i18n/localized-text";
import type { InterpretRequest } from "../nlu/interpreter";
import { resolveField } from "../profile/field-ref";
import { parseJsonl } from "./jsonl";

export { DatasetError } from "./jsonl";

const PendingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("value"), field: z.string().min(1) }),
  z.strictObject({ kind: z.literal("edit"), field: z.string().min(1) }),
  z.strictObject({ kind: z.literal("delete_data") }),
]);

/** A sketch of SessionState: enough to rebuild the context the LLM sees (D92). */
const StateSketchSchema = z.strictObject({
  phase: z.enum(["language", "flow", "post_completion"]).default("flow"),
  step: z.string().min(1).optional(),
  question: z.string().min(1).optional(),
  sessionLanguage: LanguageCodeSchema.default("it"),
  consentsAccepted: z.boolean().default(true),
  /** Field → value already collected. */
  profile: z.record(z.string(), z.unknown()).default({}),
  pending: PendingSchema.optional(),
});

const ExpectedSchema = z.strictObject({
  intent: z.enum(INTENTS).optional(),
  choice: z.string().min(1).optional(),
  /** The language the message is written in. */
  language: LanguageCodeSchema.optional(),
  completeness: z.enum(COMPLETENESS).optional(),
  /** Exhaustive (D92): everything the message says. Omitted = nothing to extract. */
  patch: z.record(z.string(), z.unknown()).default({}),
  editTarget: z.strictObject({ field: z.string().min(1), newValue: z.unknown() }).optional(),
});

export const EvalCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
  tags: z.array(z.string().min(1)).default([]),
  /** The language of the message: evals are split by it (D95). */
  language: LanguageCodeSchema,
  state: StateSketchSchema.prefault({}),
  /** Earlier messages of the candidate, oldest first. */
  history: z.array(z.string()).default([]),
  message: z.string().min(1),
  expected: ExpectedSchema,
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

function isKnownField(ref: string, campaign: CampaignDefinition): boolean {
  const def = resolveField(ref, campaign.customFields);
  return def !== undefined && def.systemOnly !== true;
}

function semanticProblem(c: EvalCase, campaign: CampaignDefinition): string | undefined {
  const { state, expected } = c;
  if (state.phase === "flow" && state.step === undefined) return "a flow case needs a step";
  if (state.question !== undefined) {
    const step = campaign.flow.find((s) => s.id === state.step);
    if (step?.type !== "questions" || !step.questions.some((q) => q.id === state.question)) {
      return `unknown question "${state.question}" in step "${state.step ?? ""}"`;
    }
  } else if (state.step !== undefined && !campaign.flow.some((s) => s.id === state.step)) {
    return `unknown step "${state.step}"`;
  }
  const fields = [
    ...Object.keys(state.profile),
    ...Object.keys(expected.patch),
    ...(state.pending && "field" in state.pending ? [state.pending.field] : []),
    ...(expected.editTarget ? [expected.editTarget.field] : []),
  ];
  const unknown = fields.find((field) => !isKnownField(field, campaign));
  return unknown === undefined ? undefined : `unknown or system-only field "${unknown}"`;
}

/** Parses a whole dataset file; the first problem throws a DatasetError naming the line. */
export function parseDataset(text: string, campaign: CampaignDefinition, source: string) {
  return parseJsonl(text, source, EvalCaseSchema, (c) => semanticProblem(c, campaign));
}

function pendingConfirmation(pending: z.infer<typeof PendingSchema>): PendingConfirmation {
  switch (pending.kind) {
    case "delete_data":
      return { kind: "delete_data" };
    case "value":
      // Values never reach the LLM (D85): placeholders are enough.
      return { kind: "value", field: pending.field, value: null, confidence: 0.5 };
    case "edit":
      return { kind: "edit", field: pending.field, oldValue: null, newValue: null };
  }
}

export function buildState(c: EvalCase): SessionState {
  const { state } = c;
  const profile: Record<string, FieldState> = {};
  for (const [field, value] of Object.entries(state.profile)) {
    profile[field] = { value, confidence: 0.9, status: "inferred" };
  }
  return {
    ...initialSessionState(),
    phase: state.phase,
    stepId: state.step ?? null,
    questionId: state.question ?? null,
    language: state.phase === "language" ? null : state.sessionLanguage,
    consentsAccepted: state.consentsAccepted,
    pendingConfirmation: state.pending ? pendingConfirmation(state.pending) : null,
    profile: profile satisfies ProfileSnapshot,
  };
}

/** The case id is the turn id, so cost can be read from the traces (D96). */
export function toInterpretRequest(c: EvalCase, campaign: CampaignDefinition): InterpretRequest {
  return {
    text: c.message,
    state: buildState(c),
    campaign,
    history: c.history,
    turnId: c.id,
  };
}
