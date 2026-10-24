import { validatePatch, type PatchEntry } from "../profile/patch";
import type { AppliedField, PatchSource } from "./effects";
import { CONFIDENCE_THRESHOLD, isFieldFilled, withField } from "./profile-snapshot";
import { emit, setState, type Turn } from "./turn";

/** Changing this field triggers geocoding (spec §12.3). */
const GEOCODED_FIELD = "address";

/** Saves fields and keeps the profile snapshot in step with the ApplyPatch effect. */
export function applyFields(
  turn: Turn,
  source: PatchSource,
  fields: readonly AppliedField[],
): void {
  if (fields.length === 0) return;
  emit(turn, { type: "ApplyPatch", source, fields });
  let profile = turn.state.profile;
  for (const f of fields) {
    profile = withField(profile, f.field, {
      value: f.value,
      confidence: f.confidence,
      status: f.status,
    });
  }
  setState(turn, { profile });
  if (fields.some((f) => f.field === GEOCODED_FIELD)) {
    emit(turn, { type: "EnqueueJob", job: { name: "geocoding" } });
  }
}

/**
 * Spec §7.2 point 2 and D35: every valid, confident extracted value is saved, asked or not, but
 * only after the consent threshold and never over a filled field other than `currentField`.
 * Returns the low-confidence value for `currentField`, which needs a confirmation.
 */
export function applyExtractedPatch(
  turn: Turn,
  entries: readonly PatchEntry[],
  currentField: string | undefined,
): PatchEntry | undefined {
  if (!turn.state.consentsAccepted || entries.length === 0) return undefined;
  const { accepted, rejected } = validatePatch(entries, turn.campaign.customFields);
  if (rejected.length > 0) emit(turn, { type: "RecordPatchRejections", rejected });

  const open = accepted.filter(
    (e) => e.field === currentField || !isFieldFilled(turn.state.profile, e.field),
  );
  applyFields(
    turn,
    "extraction",
    open
      .filter((e) => e.confidence >= CONFIDENCE_THRESHOLD)
      .map((e): AppliedField => ({
        field: e.field,
        value: e.value,
        confidence: e.confidence,
        status: "inferred",
      })),
  );
  return open.find((e) => e.confidence < CONFIDENCE_THRESHOLD && e.field === currentField);
}
