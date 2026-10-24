import type { Interpretation } from "../engine/interpretation";
import type { ProfileSnapshot } from "../engine/profile-snapshot";
import type { PendingConfirmation } from "../engine/state";
import type { CustomFieldDefinition } from "../profile/custom-fields";
import { resolveField } from "../profile/field-ref";

/**
 * Spec §8.2 / D85: these values never reach the LLM, not even in the summary. `phone`,
 * `lat` and `lng` are systemOnly and listed for the history scrub only.
 */
export const WITHHELD_FIELDS: ReadonlySet<string> = new Set([
  "firstName",
  "lastName",
  "birthday",
  "address",
  "email",
  "phone",
  "lat",
  "lng",
]);

/** D85 + sensitive fields: their values are withheld from the context and the history. */
export function isWithheldField(
  field: string,
  customFields: readonly CustomFieldDefinition[],
): boolean {
  return WITHHELD_FIELDS.has(field) || resolveField(field, customFields)?.sensitive === true;
}

export interface ScrubSources {
  readonly profile: ProfileSnapshot;
  /** A value waiting for its confirmation comes from an earlier message too. */
  readonly pending: PendingConfirmation | null;
  /** Required, so a custom sensitive field cannot be forgotten. */
  readonly customFields: readonly CustomFieldDefinition[];
}

/**
 * Shorter values would match ordinary words. Names go down to 2 letters ("Li", "Bo"): whole-word
 * matching keeps them from eating longer words, and short names are common among candidates.
 */
const MIN_SCRUB_LENGTH = 3;
const MIN_NAME_SCRUB_LENGTH = 2;
const NAME_FIELDS: ReadonlySet<string> = new Set(["firstName", "lastName"]);

interface KnownValue {
  readonly field: string;
  readonly value: unknown;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The ways a stored value may appear in a message. */
function writtenForms(field: string, value: unknown): string[] {
  if (typeof value !== "string") return [];
  const date = field === "birthday" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!date) return [value];
  const [, year = "", month = "", day = ""] = date;
  return [value, `${day}/${month}/${year}`, `${Number(day)}/${Number(month)}/${year}`];
}

/** The values a pending confirmation carries: not saved yet, but written by the candidate. */
function pendingValues(pending: PendingConfirmation | null): KnownValue[] {
  if (!pending) return [];
  switch (pending.kind) {
    case "value":
      return [{ field: pending.field, value: pending.value }];
    case "edit":
      return [
        { field: pending.field, value: pending.oldValue },
        { field: pending.field, value: pending.newValue },
      ];
    case "delete_data":
      return [];
  }
}

interface Secret {
  readonly field: string;
  readonly text: string;
}

/** Each known value of a withheld field as the spans to look for. */
function secretsOf(
  known: readonly KnownValue[],
  customFields: readonly CustomFieldDefinition[],
  evidence: readonly Secret[] = [],
): Secret[] {
  return (
    [
      ...known
        .filter(({ field }) => isWithheldField(field, customFields))
        .flatMap(({ field, value }) => writtenForms(field, value).map((text) => ({ field, text }))),
      ...evidence.filter(({ field }) => isWithheldField(field, customFields)),
    ]
      .map(({ field, text }) => ({ field, text: text.trim() }))
      .filter(
        ({ field, text }) =>
          text.length >= (NAME_FIELDS.has(field) ? MIN_NAME_SCRUB_LENGTH : MIN_SCRUB_LENGTH),
      )
      // Longest first: "Via Garibaldi 12" before a shorter value it may contain.
      .sort((a, b) => b.text.length - a.text.length)
  );
}

function redact(message: string, secrets: readonly Secret[]): string {
  return secrets.reduce(
    (out, { field, text }) =>
      // Whole words only: "Ada" must not eat the start of "adatta".
      out.replace(
        new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(text)}(?![\\p{L}\\p{N}])`, "giu"),
        `[${field}]`,
      ),
    message,
  );
}

/**
 * D85: earlier messages keep their meaning but lose the personal data already collected,
 * including a value still waiting for its confirmation (it comes from an earlier message).
 * A safety net under `redactWithEvidence`: it only knows values in their stored form.
 */
export function scrubHistory(
  history: readonly string[],
  { profile, pending, customFields }: ScrubSources,
): string[] {
  const known: KnownValue[] = [
    ...Object.entries(profile).map(([field, state]) => ({ field, value: state.value })),
    ...pendingValues(pending),
  ];
  const secrets = secretsOf(known, customFields);
  return history.map((message) => redact(message, secrets));
}

/**
 * The copy of a candidate message kept for later NLU history: the spans the LLM quoted as
 * evidence for a personal or sensitive field, and those values as written, become `[field]`.
 * It works whether or not the value was saved (before the consents, a turn intercepted by a
 * global keyword, a low-confidence or invalid value) and catches forms the profile scrub
 * cannot ("12 maggio 1990"). Runtime stores this copy (plan 08); the simulator keeps it.
 */
export function redactWithEvidence(
  message: string,
  interpretation: Interpretation | null,
  customFields: readonly CustomFieldDefinition[],
): string {
  if (!interpretation) return message;
  const known: KnownValue[] = interpretation.patch.map(({ field, value }) => ({ field, value }));
  if (interpretation.editTarget) {
    known.push({
      field: interpretation.editTarget.field,
      value: interpretation.editTarget.newValue,
    });
  }
  const evidence = interpretation.patch.map(({ field, evidence: text }) => ({ field, text }));
  return redact(message, secretsOf(known, customFields, evidence));
}
