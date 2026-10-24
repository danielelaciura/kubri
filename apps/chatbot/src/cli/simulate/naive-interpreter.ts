import type { ChoiceStep } from "../../campaigns/schema/steps";
import { isNoKeyword, isYesKeyword } from "../../engine/global-intents";
import type { Interpretation } from "../../engine/interpretation";
import { normalizeText } from "../../engine/normalize-text";
import type { InterpretRequest, Interpreter } from "../../nlu/interpreter";
import { baseInterpretation, coerceValue, currentField } from "./interpretations";

function yesNo(text: string): "yes" | "no" | undefined {
  if (isYesKeyword(text)) return "yes";
  return isNoKeyword(text) ? "no" : undefined;
}

/** An option id, its 1-based position, or yes/no for options called "yes"/"no". */
function matchOption(step: ChoiceStep, text: string): string | undefined {
  const normalized = normalizeText(text);
  const byId = step.options.find((o) => normalizeText(o.id) === normalized);
  if (byId) return byId.id;
  const position = Number(normalized);
  if (Number.isInteger(position) && position >= 1) return step.options[position - 1]?.id;
  const answer = yesNo(text);
  return answer && step.options.some((o) => o.id === answer) ? answer : undefined;
}

/** A deterministic stand-in for the LLM (D79): plain answers only, the rest via commands. */
export function naiveInterpret({ text, state, campaign }: InterpretRequest): Interpretation {
  const base = baseInterpretation(state, campaign);
  const unclear: Interpretation = { ...base, intent: "unclear" };
  const choice = (id: string): Interpretation => ({ ...base, intent: "choice", choice: id });
  const answer = yesNo(text);
  if (state.pendingConfirmation && answer) return choice(answer);
  // Post-completion with a cv_offer re-proposed (D44): a plain yes/no.
  if (state.phase === "post_completion") return answer ? choice(answer) : unclear;
  const step = campaign.flow.find((s) => s.id === state.stepId);
  if (state.phase !== "flow" || !step) return unclear;
  switch (step.type) {
    case "consent":
      return answer ? choice(answer === "yes" ? "accepted" : "declined") : unclear;
    case "cv_offer":
      return answer ? choice(answer) : unclear;
    case "choice": {
      const option = matchOption(step, text);
      return option ? choice(option) : unclear;
    }
    case "questions": {
      const current = currentField(state, campaign);
      const value = current ? coerceValue(text, current.definition) : undefined;
      if (!current || value === undefined) return unclear;
      return {
        ...base,
        patch: [{ field: current.ref, value, confidence: 0.95, evidence: text }],
        currentQuestion: { completeness: "complete" },
      };
    }
    case "message":
    case "end":
      return unclear;
  }
}

export const naiveInterpreter: Interpreter = {
  interpret: (request) => Promise.resolve(naiveInterpret(request)),
};
