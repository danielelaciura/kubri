import { stopSession } from "./advance";
import type { UserTurnEvent } from "./events";
import { confirmationAnswer, globalIntentOf, type GlobalIntent } from "./global-intents";
import { repromptCurrent } from "./replies";
import { emit, say, setState, systemText, type Turn } from "./turn";

/**
 * Spec §7.2 point 1, D39, D40: global intents and a pending deletion are handled before the
 * phase switch, in every phase (`closed` included) and before any patch. Returns true when the
 * turn was handled.
 */
export function handleGlobalTurn(turn: Turn, event: UserTurnEvent): boolean {
  const global = globalIntentOf(event.text, event.interpretation);
  if (turn.state.pendingConfirmation?.kind === "delete_data") {
    resolveDeletion(turn, event, global);
    return true;
  }
  if (!global) return false;
  if (global === "opt_out") optOut(turn);
  else askDeletion(turn);
  return true;
}

/** Owner decision (plan 04 Task 21): deletion is confirmed first; nothing is touched yet. */
function askDeletion(turn: Turn): void {
  setState(turn, { pendingConfirmation: { kind: "delete_data" } });
  say(turn, systemText("system.delete_confirm"));
}

/**
 * Yes (or the deletion asked again) deletes; an opt-out cancels the deletion and stops;
 * anything else cancels it and resumes where the conversation was, without processing it.
 */
function resolveDeletion(turn: Turn, event: UserTurnEvent, global: GlobalIntent | undefined): void {
  setState(turn, { pendingConfirmation: null });
  if (global === "opt_out") {
    say(turn, systemText("system.delete_cancelled"));
    optOut(turn);
    return;
  }
  if (global === "delete_data" || confirmationAnswer(event.text, event.interpretation) === "yes") {
    deleteData(turn);
    return;
  }
  say(turn, systemText("system.delete_cancelled"));
  resume(turn);
}

/** D39: always delete, whatever the threshold or onStop, plus the delete-contact job. */
function deleteData(turn: Turn): void {
  const goodbye = systemText("system.delete_done");
  emit(turn, { type: "EnqueueJob", job: { name: "delete-contact" } });
  const { phase } = turn.state;
  if (phase === "language" || phase === "flow") {
    stopSession(turn, "delete_data", { goodbye, dataPolicy: "delete" });
    return;
  }
  say(turn, goodbye);
  closeQuietly(turn);
}

/** D39: before completion the stop follows the threshold and onStop; after it, data is kept. */
function optOut(turn: Turn): void {
  const goodbye = systemText("system.opt_out_confirm");
  const { phase } = turn.state;
  if (phase === "language" || phase === "flow") {
    stopSession(turn, "opt_out", { goodbye });
  } else {
    say(turn, goodbye);
    closeQuietly(turn);
  }
  emit(turn, { type: "OptOut", at: turn.at });
}

/** A completed or closed session is closed without a StopSession (its data policy stands). */
function closeQuietly(turn: Turn): void {
  setState(turn, {
    phase: "closed",
    stepId: null,
    questionId: null,
    clarifications: 0,
    pendingConfirmation: null,
  });
}

/** Back to where the conversation was before the deletion request. */
function resume(turn: Turn): void {
  switch (turn.state.phase) {
    case "language":
      say(turn, systemText("system.welcome"));
      return;
    case "flow":
      repromptCurrent(turn);
      return;
    case "post_completion":
      // A CV regeneration being offered (D44) is asked again; otherwise the cancel is enough.
      if (turn.state.stepId !== null) repromptCurrent(turn);
      return;
    case "closed":
      return;
  }
}
