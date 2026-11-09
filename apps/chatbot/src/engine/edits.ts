import { validatePatch } from "../profile/patch";
import type { Interpretation } from "./interpretation";
import { applyFields } from "./patches";
import { fieldState } from "./profile-snapshot";
import type { EditConfirmation } from "./state";
import { toTextParam } from "./text-ref";
import { say, setState, systemText, type Turn } from "./turn";

/**
 * Asks to confirm an edit, with the old and the new value (spec §5.7, §7.2 point 5).
 * Returns false when the edit cannot be used: no target, invalid value, or no consent yet.
 */
export function requestEdit(turn: Turn, interpretation: Interpretation): boolean {
  const target = interpretation.editTarget;
  if (!target || !turn.state.consentsAccepted) return false;
  const { accepted } = validatePatch(
    [{ field: target.field, value: target.newValue, confidence: 1, evidence: "" }],
    turn.campaign.customFields,
  );
  const entry = accepted[0];
  if (!entry) return false;
  const oldValue = fieldState(turn.state.profile, entry.field)?.value ?? null;
  setState(turn, {
    pendingConfirmation: { kind: "edit", field: entry.field, oldValue, newValue: entry.value },
  });
  say(
    turn,
    systemText("system.confirm_edit", {
      field: entry.field,
      oldValue: toTextParam(oldValue),
      newValue: toTextParam(entry.value),
    }),
  );
  return true;
}

/** Saves a confirmed edit as `ProfileChange(source: edit)`. */
export function saveEdit(turn: Turn, pending: EditConfirmation): void {
  applyFields(turn, "edit", [
    { field: pending.field, value: pending.newValue, confidence: 1, status: "confirmed" },
  ]);
  say(turn, systemText("system.edit_saved"));
}
