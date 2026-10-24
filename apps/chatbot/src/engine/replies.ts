import type { Question, QuestionsStep } from "../campaigns/schema/steps";
import { consentTextRef, questionTextRef } from "./advance";
import type { Interpretation } from "./interpretation";
import { stepTextRef } from "./text-ref";
import { currentStep, incoherent, say, systemText, type Turn } from "./turn";

export function currentQuestion(turn: Turn, step: QuestionsStep): Question {
  return (
    step.questions.find((q) => q.id === turn.state.questionId) ??
    incoherent(`unknown current question "${turn.state.questionId ?? "none"}"`)
  );
}

/** Sends the current step's question again. */
export function repromptCurrent(turn: Turn): void {
  const { step } = currentStep(turn);
  switch (step.type) {
    case "choice":
    case "cv_offer":
      say(turn, stepTextRef(step.prompt, step.id));
      return;
    case "consent":
      say(turn, consentTextRef(turn, step));
      return;
    case "questions":
      say(turn, questionTextRef(step, currentQuestion(turn, step)));
      return;
    case "message":
    case "end":
      incoherent(`step "${step.id}" (${step.type}) never waits for an answer`);
  }
}

/** Not an answer to the current step: say so, then ask again. */
export function nonAnswer(turn: Turn, _interpretation: Interpretation | null): void {
  say(turn, systemText("system.not_understood"));
  repromptCurrent(turn);
}
