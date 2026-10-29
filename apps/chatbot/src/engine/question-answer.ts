import type { Question, QuestionsStep } from "../campaigns/schema/steps";
import type { PatchEntry } from "../profile/patch";
import { advanceFromQuestion, askQuestion, giveUpQuestion } from "./advance";
import { askConfirmation } from "./confirmations";
import type { Interpretation } from "./interpretation";
import { fieldState, holdsValue, isFieldFilled, type FieldState } from "./profile-snapshot";
import { currentQuestion } from "./replies";
import { setState, type Turn } from "./turn";

/** What the turn's patch did to the current question's field. */
export interface PatchOutcome {
  /** The field's state before the patch: tells an answer apart from a stale saved value. */
  readonly fieldBefore: FieldState | undefined;
  /** A value for the field below the confidence threshold: it needs a confirmation. */
  readonly lowConfidence: PatchEntry | undefined;
}

/** Spec §7.2 points 2–3 and D43. Runs after the turn's patch has been applied. */
export function answerQuestion(
  turn: Turn,
  index: number,
  step: QuestionsStep,
  interpretation: Interpretation,
  { fieldBefore, lowConfidence }: PatchOutcome,
): void {
  const question = currentQuestion(turn, step);
  const canClarify = turn.state.clarifications < question.maxClarifications;
  if (lowConfidence) {
    // Asking for a confirmation counts as a clarification, so the loop always ends.
    if (canClarify) askConfirmation(turn, lowConfidence);
    else giveUpQuestion(turn, index, step, question);
    return;
  }
  if (interpretation.intent === "refusal" && !question.required) {
    advanceFromQuestion(turn, index, step, question);
    return;
  }
  const after = fieldState(turn.state.profile, question.field);
  const filled = isFieldFilled(turn.state.profile, question.field);
  const { completeness, missing } = interpretation.currentQuestion;
  if (completeness === "partial" && canClarify) {
    clarify(turn, step, question, missing);
    return;
  }
  // A value saved earlier (e.g. a partial answer) is not an answer to this turn by itself.
  const changed = after !== undefined && !holdsValue(fieldBefore, after.value);
  const answeredNow = filled && (changed || completeness === "complete");
  // D56: "none" ("non ho studiato") is a complete answer to an optional question even with no
  // value; a required question still needs a value. A value that was extracted but rejected
  // by validation is not "none": the question is asked again.
  const extractedForField = interpretation.patch.some((entry) => entry.field === question.field);
  const noneToOptional = completeness === "complete" && !question.required && !extractedForField;
  if (answeredNow || noneToOptional) {
    advanceFromQuestion(turn, index, step, question);
    return;
  }
  if (canClarify) {
    rephrase(turn, step, question);
    return;
  }
  giveUpQuestion(turn, index, step, question);
}

function clarify(
  turn: Turn,
  step: QuestionsStep,
  question: Question,
  missing: string | undefined,
): void {
  setState(turn, { clarifications: turn.state.clarifications + 1 });
  askQuestion(turn, step, question, "clarify", missing ? { missing } : undefined);
}

function rephrase(turn: Turn, step: QuestionsStep, question: Question): void {
  setState(turn, { clarifications: turn.state.clarifications + 1 });
  askQuestion(turn, step, question, "rephrase");
}
