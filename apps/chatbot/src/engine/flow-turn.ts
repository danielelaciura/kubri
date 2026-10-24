import { answerChoice, answerCvOffer } from "./choice-answers";
import { answerConsent } from "./consent-answer";
import type { UserTurnEvent } from "./events";
import { applyExtractedPatch } from "./patches";
import { currentQuestion, nonAnswer } from "./replies";
import { currentStep, type Turn } from "./turn";

/** A user turn while the flow waits on a step (spec §7.2). */
export function handleFlowTurn(turn: Turn, event: UserTurnEvent): void {
  const interpretation = event.interpretation;
  if (!interpretation) {
    nonAnswer(turn, null);
    return;
  }
  const { step, index } = currentStep(turn);
  const currentField = step.type === "questions" ? currentQuestion(turn, step).field : undefined;
  applyExtractedPatch(turn, interpretation.patch, currentField);
  switch (step.type) {
    case "choice":
      answerChoice(turn, index, step, interpretation);
      return;
    case "consent":
      answerConsent(turn, index, step, interpretation);
      return;
    case "cv_offer":
      answerCvOffer(turn, index, interpretation);
      return;
    default:
      nonAnswer(turn, interpretation);
  }
}
