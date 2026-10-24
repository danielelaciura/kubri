import type { PatchEntry } from "../profile/patch";
import { advanceFromQuestion } from "./advance";
import { saveEdit } from "./edits";
import type { UserTurnEvent } from "./events";
import { confirmationAnswer } from "./global-intents";
import { applyFields } from "./patches";
import { isFieldFilled } from "./profile-snapshot";
import { currentQuestion, repromptCurrent } from "./replies";
import { toTextParam } from "./text-ref";
import { currentStep, incoherent, say, setState, systemText, type Turn } from "./turn";

/** Spec §7.2 point 2: below the threshold the value is not saved, the engine asks first. */
export function askConfirmation(turn: Turn, entry: PatchEntry): void {
  setState(turn, {
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
 * normal answer". `delete_data` is resolved before the phase switch (step.ts), never here.
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
        repromptCurrent(turn);
        return true;
      }
      return false;
    case "edit":
      if (yes) {
        saveEdit(turn, pending);
        resumeFlow(turn);
        return true;
      }
      if (no) {
        say(turn, systemText("system.edit_cancelled"));
        repromptCurrent(turn);
        return true;
      }
      return false;
    case "delete_data":
      return incoherent("delete_data confirmation reached the flow");
  }
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
