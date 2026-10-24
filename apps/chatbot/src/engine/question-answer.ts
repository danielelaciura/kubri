import type { QuestionsStep } from "../campaigns/schema/steps";
import { advanceFromQuestion } from "./advance";
import type { Interpretation } from "./interpretation";
import { isFieldFilled } from "./profile-snapshot";
import { currentQuestion, nonAnswer } from "./replies";
import type { Turn } from "./turn";

/** Spec §7.2 point 3. Runs after the turn's patch has been applied. */
export function answerQuestion(
  turn: Turn,
  index: number,
  step: QuestionsStep,
  interpretation: Interpretation,
): void {
  const question = currentQuestion(turn, step);
  if (isFieldFilled(turn.state.profile, question.field)) {
    advanceFromQuestion(turn, index, step, question);
    return;
  }
  nonAnswer(turn, interpretation);
}
