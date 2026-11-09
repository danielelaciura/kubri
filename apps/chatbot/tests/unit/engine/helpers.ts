import type { CampaignDefinition, CampaignInput } from "../../../src/campaigns/schema/campaign";
import type { Question, QuestionsStep } from "../../../src/campaigns/schema/steps";
import { describeEffect } from "../../../src/engine/describe";
import type { Effect } from "../../../src/engine/effects";
import type { EngineEvent } from "../../../src/engine/events";
import type { Interpretation } from "../../../src/engine/interpretation";
import type { FieldState } from "../../../src/engine/profile-snapshot";
import { initialSessionState, type SessionState } from "../../../src/engine/state";
import { describeTextRef } from "../../../src/engine/text-ref";
import { minimalCampaign, parsed } from "../campaigns/fixtures";

export const AT = "2026-10-24T10:00:00.000Z";

/** The minimal campaign of plan 02, optionally edited before parsing (no semantic checks). */
export function campaign(edit?: (input: CampaignInput) => void): CampaignDefinition {
  const input = minimalCampaign();
  edit?.(input);
  return parsed(input);
}

export function questionsStep(c: CampaignDefinition, id: string): QuestionsStep {
  const found = c.flow.find((s): s is QuestionsStep => s.type === "questions" && s.id === id);
  if (!found) throw new Error(`no questions step ${id}`);
  return found;
}

export function questionOf(step: QuestionsStep, id: string): Question {
  const found = step.questions.find((q) => q.id === id);
  if (!found) throw new Error(`no question ${id}`);
  return found;
}

export function interpretation(overrides: Partial<Interpretation> = {}): Interpretation {
  return {
    language: { code: "it", confidence: 0.99 },
    intent: "answer",
    patch: [],
    currentQuestion: { completeness: "absent" },
    ...overrides,
  };
}

export const choice = (id: string): Interpretation =>
  interpretation({ intent: "choice", choice: id });

export const answer = (field: string, value: unknown, confidence = 0.95): Interpretation =>
  interpretation({
    patch: [{ field, value, confidence, evidence: "…" }],
    currentQuestion: { completeness: "complete" },
  });

export function userTurn(text: string, interp: Interpretation | null = null): EngineEvent {
  return { type: "user_turn", at: AT, text, interpretation: interp };
}

export const inferred = (value: unknown): FieldState => ({
  value,
  confidence: 0.9,
  status: "inferred",
});

export function flowState(overrides: Partial<SessionState> = {}): SessionState {
  return { ...initialSessionState(), phase: "flow", language: "it", ...overrides };
}

/** The minimal campaign waiting on question `questionId` of "anagrafica", consents accepted. */
export function atQuestion(
  questionId: string,
  overrides: Partial<SessionState> = {},
): SessionState {
  return flowState({
    stepId: "anagrafica",
    questionId,
    consentsAccepted: true,
    outcomes: { intro: "next", cv_info: "yes", privacy: "accepted" },
    ...overrides,
  });
}

/** Ids of the texts sent, in order. */
export const sent = (effects: readonly Effect[]): string[] =>
  effects.flatMap((e) => (e.type === "SendText" ? [describeTextRef(e.text)] : []));

/** Descriptions of the other effects, in order. */
export const others = (effects: readonly Effect[]): string[] =>
  effects.filter((e) => e.type !== "SendText").map(describeEffect);

/** The exception thrown by `fn`. */
export function thrown(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected an exception");
}
