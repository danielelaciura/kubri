import type { ChoiceStep } from "../campaigns/schema/steps";
import { followOutcome } from "./advance";
import type { Interpretation } from "./interpretation";
import { nonAnswer } from "./replies";
import { emit, type Turn } from "./turn";

/** The option picked by a `choice` intent, if any. */
export function chosen(interpretation: Interpretation | null): string | undefined {
  return interpretation?.intent === "choice" ? interpretation.choice : undefined;
}

export function answerChoice(
  turn: Turn,
  index: number,
  step: ChoiceStep,
  interpretation: Interpretation,
): void {
  const option = chosen(interpretation);
  if (option !== undefined && step.options.some((o) => o.id === option)) {
    followOutcome(turn, index, option);
    return;
  }
  nonAnswer(turn, interpretation);
}

/** Spec §12.2: `yes` enqueues the CV generation. */
export function answerCvOffer(turn: Turn, index: number, interpretation: Interpretation): void {
  const option = chosen(interpretation);
  if (option !== "yes" && option !== "no") {
    nonAnswer(turn, interpretation);
    return;
  }
  if (option === "yes") emit(turn, { type: "EnqueueJob", job: { name: "cv" } });
  followOutcome(turn, index, option);
}
