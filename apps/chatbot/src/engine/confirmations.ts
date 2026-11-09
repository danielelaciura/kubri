import type { PatchEntry } from "../profile/patch";
import { advanceFromQuestion, giveUpQuestion } from "./advance";
import { saveEdit } from "./edits";
import type { UserTurnEvent } from "./events";
import { confirmationAnswer } from "./global-intents";
import { applyFields } from "./patches";
import { isFieldFilled } from "./profile-snapshot";
import { currentQuestion, repromptCurrent } from "./replies";
import { toTextParam } from "./text-ref";
import { currentStep, emit, say, setState, systemText, type Turn } from "./turn";

/** Spec §7.2 point 2: below the threshold the value is not saved, the engine asks first. */
export function askConfirmation(turn: Turn, entry: PatchEntry): void {
  setState(turn, {
    clarifications: turn.state.clarifications + 1,
    pendingConfirmation: {
      kind: "value",
      field: entry.field,
      value: entry.value,
      confidence: entry.confidence,
    },
  });
  say(
    turn,
    systemText("system.confirm_value", { field: entry.field, value: toTextParam(entry.value) }),
  );
}

/**
 * D36, during the flow: yes applies, no cancels and asks again, anything else drops the
 * confirmation. Returns true when the turn was handled; false means "process the message as a
 * normal answer". `delete_data` is resolved before the phase switch (global-turn.ts).
 */
export function resolvePendingInFlow(turn: Turn, event: UserTurnEvent): boolean {
  const pending = turn.state.pendingConfirmation;
  if (!pending) return false;
  setState(turn, { pendingConfirmation: null });
  const answer = confirmationAnswer(event.text, event.interpretation);
  const yes = answer === "yes";
  const no = answer === "no";
  switch (pending.kind) {
    case "value":
      if (yes) {
        applyFields(turn, "extraction", [
          { field: pending.field, value: pending.value, confidence: 1, status: "confirmed" },
        ]);
        resumeFlow(turn);
        return true;
      }
      if (no) {
        retryQuestion(turn);
        return true;
      }
      return false;
    case "edit":
      if (yes) {
        saveEdit(turn, pending);
        // Editing another field must not skip a follow-up still pending on the current one.
        if (pending.field === currentField(turn)) resumeFlow(turn);
        else repromptCurrent(turn);
        return true;
      }
      if (no) {
        say(turn, systemText("system.edit_cancelled"));
        repromptCurrent(turn);
        return true;
      }
      return false;
    case "delete_data":
      // Resolved before the phase switch (global-turn.ts): reaching here means a stale state.
      dropStaleConfirmation(turn);
      return false;
  }
}

/**
 * D53: a pending confirmation that does not fit the phase is dropped and flagged, and the turn
 * goes on normally, so the session never stays stuck on it (step() would otherwise keep the
 * old state on an EngineError, forever).
 */
export function dropStaleConfirmation(turn: Turn): void {
  setState(turn, { pendingConfirmation: null });
  emit(turn, { type: "FlagSession", reason: "stale_confirmation", needsAttention: true });
}

/** A rejected value: ask again, counting it as a clarification, or give up at the limit. */
function retryQuestion(turn: Turn): void {
  const { step, index } = currentStep(turn);
  if (step.type !== "questions") {
    repromptCurrent(turn);
    return;
  }
  const question = currentQuestion(turn, step);
  if (turn.state.clarifications >= question.maxClarifications) {
    giveUpQuestion(turn, index, step, question);
    return;
  }
  setState(turn, { clarifications: turn.state.clarifications + 1 });
  repromptCurrent(turn);
}

/** The field of the question waiting for an answer, if the current step is a questions block. */
function currentField(turn: Turn): string | undefined {
  const { step } = currentStep(turn);
  return step.type === "questions" ? currentQuestion(turn, step).field : undefined;
}

/** Moves on if the current question is now answered, otherwise asks it again. */
export function resumeFlow(turn: Turn): void {
  const { step, index } = currentStep(turn);
  if (step.type === "questions") {
    const question = currentQuestion(turn, step);
    if (isFieldFilled(turn.state.profile, question.field)) {
      advanceFromQuestion(turn, index, step, question);
      return;
    }
  }
  repromptCurrent(turn);
}
