import { answerChoice, answerCvOffer } from "./choice-answers";
import { resolvePendingInFlow } from "./confirmations";
import { answerConsent } from "./consent-answer";
import type { UserTurnEvent } from "./events";
import { applyExtractedPatch } from "./patches";
import { fieldState } from "./profile-snapshot";
import { answerQuestion } from "./question-answer";
import { currentQuestion, nonAnswer } from "./replies";
import { currentStep, incoherent, type Turn } from "./turn";

/** A user turn while the flow waits on a step (spec §7.2). */
export function handleFlowTurn(turn: Turn, event: UserTurnEvent): void {
  const interpretation = event.interpretation;
  if (resolvePendingInFlow(turn, interpretation)) return;
  if (!interpretation) {
    nonAnswer(turn, null);
    return;
  }
  // Not answers: nothing extracted from them is saved, and no clarification is used up (D43).
  if (interpretation.intent === "off_topic" || interpretation.intent === "help") {
    nonAnswer(turn, interpretation);
    return;
  }
  const { step, index } = currentStep(turn);
  const currentField = step.type === "questions" ? currentQuestion(turn, step).field : undefined;
  const fieldBefore =
    currentField === undefined ? undefined : fieldState(turn.state.profile, currentField);
  const lowConfidence = applyExtractedPatch(turn, interpretation.patch, currentField);
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
    case "questions":
      answerQuestion(turn, index, step, interpretation, { fieldBefore, lowConfidence });
      return;
    case "message":
    case "end":
      incoherent(`step "${step.id}" (${step.type}) never waits for an answer`);
  }
}
