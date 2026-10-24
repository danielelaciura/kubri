import type { Question, QuestionsStep } from "../campaigns/schema/steps";
import { consentTextRef, questionTextRef } from "./advance";
import type { Interpretation } from "./interpretation";
import { stepTextRef, type TextRef } from "./text-ref";
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

/** Not an answer to the current step: a short lead text, then the question again (§7.2 p. 4). */
export function nonAnswer(turn: Turn, interpretation: Interpretation | null): void {
  say(turn, leadText(interpretation));
  repromptCurrent(turn);
}

function leadText(interpretation: Interpretation | null): TextRef {
  if (interpretation?.intent === "off_topic") {
    return interpretation.offTopicReply
      ? { kind: "generated", text: interpretation.offTopicReply }
      : systemText("system.off_topic");
  }
  if (interpretation?.intent === "help") return systemText("system.help");
  return systemText("system.not_understood");
}
