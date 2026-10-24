import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { Question, Step, StepType, TextValue } from "../campaigns/schema/steps";
import { REGENERATE_CV_CHOICE } from "../engine/post-completion";
import { fieldState, isFieldSettled, type ProfileSnapshot } from "../engine/profile-snapshot";
import type { Phase, SessionState } from "../engine/state";
import type { LanguageCode } from "../i18n/localized-text";
import type { FieldType } from "../profile/field-definition";
import { resolveField } from "../profile/field-ref";
import type { InterpretRequest } from "./interpreter";
import { isWithheldField, scrubHistory } from "./minimize";

export interface FieldBrief {
  readonly field: string;
  readonly type: FieldType;
  /** Normalization guidance (spec §6), read by the LLM. */
  readonly description: string;
  readonly options?: readonly string[];
}

export interface QuestionBrief extends FieldBrief {
  readonly id: string;
  /** The reference wording, in Italian (D86). */
  readonly prompt: string;
  readonly hint?: string;
  readonly required: boolean;
  /**
   * The value already saved for this field, e.g. the first part of a partial answer, so the
   * LLM can merge "12, Bologna" with "Via Garibaldi". Sent even for a withheld field: this
   * turn needs it (spec §8.2), and only for the current question.
   */
  readonly savedValue?: unknown;
}

export interface ChoiceBrief {
  readonly id: string;
  readonly description: string;
}

/** What the bot asked to confirm, never the values (D84, D85). */
export type PendingBrief =
  { readonly kind: "value" | "edit"; readonly field: string } | { readonly kind: "delete_data" };

export type CollectedBrief =
  | { readonly field: string; readonly description: string; readonly value: unknown }
  | { readonly field: string; readonly description: string; readonly withheld: true };

/** Spec §8.2. Serialized as is into the `interpret` prompt (and into eval cases, plan 07). */
export interface InterpretContext {
  readonly phase: Phase;
  readonly sessionLanguage: LanguageCode | null;
  readonly step: { readonly id: string; readonly type: StepType; readonly prompt?: string } | null;
  readonly question: QuestionBrief | null;
  readonly openFields: readonly FieldBrief[];
  readonly collected: readonly CollectedBrief[];
  readonly pendingConfirmation: PendingBrief | null;
  /** The ids `choice` may take in this turn; empty = no choice expected (D86). */
  readonly expectedChoices: readonly ChoiceBrief[];
  /** Earlier user messages, scrubbed (D85). */
  readonly history: readonly string[];
}

const YES_NO: readonly ChoiceBrief[] = [
  { id: "yes", description: "yes, confirms or agrees" },
  { id: "no", description: "no, does not confirm or does not agree" },
];

const CONSENT_CHOICES: readonly ChoiceBrief[] = [
  { id: "accepted", description: "agrees to the text" },
  { id: "declined", description: "does not agree to the text" },
];

const REGENERATE_CV: ChoiceBrief = {
  id: REGENERATE_CV_CHOICE,
  description: "asks to prepare the CV again",
};

function italian(value: TextValue, campaign: CampaignDefinition): string {
  const text = "ref" in value ? campaign.texts[value.ref] : value;
  return text?.["it"] ?? "";
}

function fieldBrief(ref: string, campaign: CampaignDefinition): FieldBrief | undefined {
  const def = resolveField(ref, campaign.customFields);
  if (!def || def.systemOnly) return undefined;
  const brief = { field: ref, type: def.type, description: def.description };
  return def.options ? { ...brief, options: def.options } : brief;
}

function questionBrief(
  question: Question,
  campaign: CampaignDefinition,
  profile: ProfileSnapshot,
): QuestionBrief | null {
  const field = fieldBrief(question.field, campaign);
  if (!field) return null;
  const saved = fieldState(profile, question.field);
  return {
    id: question.id,
    ...field,
    prompt: italian(question.prompt, campaign),
    ...(question.hint ? { hint: question.hint } : {}),
    required: question.required,
    ...(saved && saved.status !== "unresolved" ? { savedValue: saved.value } : {}),
  };
}

function stepBrief(step: Step, campaign: CampaignDefinition): InterpretContext["step"] {
  return step.type === "choice" || step.type === "cv_offer"
    ? { id: step.id, type: step.type, prompt: italian(step.prompt, campaign) }
    : { id: step.id, type: step.type };
}

/**
 * D86: every field of the campaign still open, not just the block's, because early answers
 * drive the skip of §5.3. Nothing while no data could be saved (phase, consent threshold).
 */
function openFields(
  state: SessionState,
  campaign: CampaignDefinition,
  step: Step | undefined,
  currentField: string | undefined,
): FieldBrief[] {
  if (state.phase !== "flow") return [];
  if (!state.consentsAccepted && step?.type !== "consent") return [];
  const seen = new Set(currentField === undefined ? [] : [currentField]);
  const fields: FieldBrief[] = [];
  for (const s of campaign.flow) {
    if (s.type !== "questions") continue;
    for (const q of s.questions) {
      if (seen.has(q.field) || isFieldSettled(state.profile, q.field)) continue;
      seen.add(q.field);
      const brief = fieldBrief(q.field, campaign);
      if (brief) fields.push(brief);
    }
  }
  return fields;
}

function collected(state: SessionState, campaign: CampaignDefinition): CollectedBrief[] {
  return Object.entries(state.profile).flatMap(([field, s]): CollectedBrief[] => {
    if (s.status === "unresolved") return [];
    const def = resolveField(field, campaign.customFields);
    if (!def || def.systemOnly) return [];
    return isWithheldField(field, campaign.customFields)
      ? [{ field, description: def.description, withheld: true }]
      : [{ field, description: def.description, value: s.value }];
  });
}

function pendingBrief(state: SessionState): PendingBrief | null {
  const pending = state.pendingConfirmation;
  if (!pending) return null;
  return pending.kind === "delete_data"
    ? { kind: "delete_data" }
    : { kind: pending.kind, field: pending.field };
}

function expectedChoices(
  state: SessionState,
  campaign: CampaignDefinition,
  step: Step | undefined,
): readonly ChoiceBrief[] {
  // D84: a pending confirmation takes every yes/no for itself.
  if (state.pendingConfirmation) return YES_NO;
  if (state.phase === "post_completion") {
    if (step?.type === "cv_offer") return YES_NO;
    return campaign.afterCompletion.allowCvRegeneration ? [REGENERATE_CV] : [];
  }
  if (state.phase !== "flow" || !step) return [];
  switch (step.type) {
    case "choice":
      return step.options.map(({ id, description }) => ({ id, description }));
    case "consent":
      return CONSENT_CHOICES;
    case "cv_offer":
      return YES_NO;
    case "message":
    case "questions":
    case "end":
      return [];
  }
}

export function buildInterpretContext(
  request: InterpretRequest,
  historyMessages: number,
): InterpretContext {
  const { state, campaign } = request;
  const step = state.stepId === null ? undefined : campaign.flow.find((s) => s.id === state.stepId);
  const question =
    step?.type === "questions" ? step.questions.find((q) => q.id === state.questionId) : undefined;
  const earlier = historyMessages === 0 ? [] : request.history.slice(-historyMessages);
  return {
    phase: state.phase,
    sessionLanguage: state.language,
    step: step ? stepBrief(step, campaign) : null,
    question: question ? questionBrief(question, campaign, state.profile) : null,
    openFields: openFields(state, campaign, step, question?.field),
    collected: collected(state, campaign),
    pendingConfirmation: pendingBrief(state),
    expectedChoices: expectedChoices(state, campaign, step),
    history: scrubHistory(earlier, {
      profile: state.profile,
      pending: state.pendingConfirmation,
      customFields: campaign.customFields,
    }),
  };
}
