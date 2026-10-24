import type { CvOfferStep } from "../campaigns/schema/steps";
import { chosen } from "./choice-answers";
import { requestEdit, saveEdit } from "./edits";
import type { UserTurnEvent } from "./events";
import { isChoice, type Interpretation } from "./interpretation";
import { nonAnswer } from "./replies";
import { stepTextRef, type TextRef } from "./text-ref";
import { emit, incoherent, say, setState, systemText, type Turn } from "./turn";

/** The choice nlu returns, in post-completion mode, for "regenerate my CV" (D44). */
export const REGENERATE_CV_CHOICE = "regenerate_cv";

/**
 * Spec §5.7: messages after the interview is completed, gated by `afterCompletion`. Extracted
 * values outside an edit request are never saved here.
 */
export function handlePostCompletionTurn(turn: Turn, event: UserTurnEvent): void {
  const interpretation = event.interpretation;
  if (resolvePendingEdit(turn, interpretation)) return;
  if (turn.state.stepId !== null) {
    answerCvRegeneration(turn, interpretation);
    return;
  }
  const { allowEdits, allowCvRegeneration } = turn.campaign.afterCompletion;
  if (interpretation?.intent === "edit_request") {
    if (!allowEdits) say(turn, systemText("system.edit_not_allowed"));
    else if (!requestEdit(turn, interpretation)) say(turn, systemText("system.edit_invalid"));
    return;
  }
  if (allowCvRegeneration && isChoice(interpretation, REGENERATE_CV_CHOICE)) {
    const cvOffer = turn.campaign.flow.find((s): s is CvOfferStep => s.type === "cv_offer");
    if (cvOffer) {
      setState(turn, { stepId: cvOffer.id });
      say(turn, stepTextRef(cvOffer.prompt, cvOffer.id));
      return;
    }
  }
  say(turn, postCompletionHelp(turn));
}

/**
 * D36 after completion: yes saves the edit and notifies Kubri, no cancels it, anything else
 * drops it and the message is handled normally. Returns true when the turn was handled.
 */
function resolvePendingEdit(turn: Turn, interpretation: Interpretation | null): boolean {
  const pending = turn.state.pendingConfirmation;
  if (!pending) return false;
  switch (pending.kind) {
    case "edit":
      setState(turn, { pendingConfirmation: null });
      if (isChoice(interpretation, "yes")) {
        saveEdit(turn, pending);
        emit(turn, {
          type: "EnqueueJob",
          job: { name: "kubri-webhook", event: "profile.updated" },
        });
        return true;
      }
      if (isChoice(interpretation, "no")) {
        say(turn, systemText("system.edit_cancelled"));
        return true;
      }
      return false;
    case "value":
      return incoherent("value confirmation after completion");
    case "delete_data":
      return incoherent("delete_data confirmation reached post-completion");
  }
}

/** The answer to a cv_offer re-proposed after completion: no transitions are followed. */
function answerCvRegeneration(turn: Turn, interpretation: Interpretation | null): void {
  const option = chosen(interpretation);
  if (option !== "yes" && option !== "no") {
    nonAnswer(turn, interpretation);
    return;
  }
  setState(turn, { stepId: null });
  if (option === "yes") {
    emit(turn, { type: "EnqueueJob", job: { name: "cv" } });
    say(turn, systemText("system.cv_requested"));
    return;
  }
  say(turn, postCompletionHelp(turn));
}

export function postCompletionHelp(turn: Turn): TextRef {
  const { allowEdits, allowCvRegeneration } = turn.campaign.afterCompletion;
  return systemText("system.post_completion_help", { allowEdits, allowCvRegeneration });
}
