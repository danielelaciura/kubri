import type { Question, QuestionsStep } from "../campaigns/schema/steps";
import type { PatchEntry } from "../profile/patch";
import { advanceFromQuestion, askQuestion } from "./advance";
import { askConfirmation } from "./confirmations";
import type { Interpretation } from "./interpretation";
import { fieldState, isFieldFilled, withField, type FieldState } from "./profile-snapshot";
import { currentQuestion, nonAnswer } from "./replies";
import { emit, setState, type Turn } from "./turn";

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
  if (lowConfidence) {
    askConfirmation(turn, lowConfidence);
    return;
  }
  if (interpretation.intent === "off_topic" || interpretation.intent === "help") {
    nonAnswer(turn, interpretation);
    return;
  }
  if (interpretation.intent === "refusal" && !question.required) {
    advanceFromQuestion(turn, index, step, question);
    return;
  }
  const after = fieldState(turn.state.profile, question.field);
  const filled = isFieldFilled(turn.state.profile, question.field);
  const { completeness, missing } = interpretation.currentQuestion;
  const canClarify = turn.state.clarifications < question.maxClarifications;
  if (completeness === "partial" && canClarify) {
    clarify(turn, step, question, missing);
    return;
  }
  // A value saved earlier (e.g. a partial answer) is not an answer to this turn by itself.
  const answeredNow = filled && (after !== fieldBefore || completeness === "complete");
  if (answeredNow) {
    advanceFromQuestion(turn, index, step, question);
    return;
  }
  if (canClarify) {
    rephrase(turn, step, question);
    return;
  }
  giveUp(turn, index, step, question, filled);
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

/**
 * Clarifications used up: a value saved earlier is kept; otherwise optional → skipped,
 * required → unresolved + FlagSession.
 */
function giveUp(
  turn: Turn,
  index: number,
  step: QuestionsStep,
  question: Question,
  filled: boolean,
): void {
  if (question.required && !filled) {
    emit(
      turn,
      { type: "MarkFieldUnresolved", field: question.field },
      {
        type: "FlagSession",
        reason: "unresolved_field",
        needsAttention: false,
        field: question.field,
      },
    );
    setState(turn, {
      profile: withField(turn.state.profile, question.field, {
        value: null,
        confidence: 0,
        status: "unresolved",
      }),
    });
  }
  advanceFromQuestion(turn, index, step, question);
}
