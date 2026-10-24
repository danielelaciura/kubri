import type { ProfileSnapshot } from "../engine/profile-snapshot";
import type { PendingConfirmation } from "../engine/state";

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

/** Shorter values would match inside ordinary words. */
const MIN_SCRUB_LENGTH = 3;

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

/**
 * D85: earlier messages keep their meaning but lose the personal data already collected,
 * including a value still waiting for its confirmation (it comes from an earlier message).
 */
export function scrubHistory(
  history: readonly string[],
  profile: ProfileSnapshot,
  pending: PendingConfirmation | null = null,
): string[] {
  const known: KnownValue[] = [
    ...Object.entries(profile).map(([field, state]) => ({ field, value: state.value })),
    ...pendingValues(pending),
  ];
  const secrets = known
    .filter(({ field }) => WITHHELD_FIELDS.has(field))
    .flatMap(({ field, value }) =>
      writtenForms(field, value).map((text) => ({ field, text: text.trim() })),
    )
    .filter(({ text }) => text.length >= MIN_SCRUB_LENGTH)
    // Longest first: "Via Garibaldi 12" before a shorter value it may contain.
    .sort((a, b) => b.text.length - a.text.length);
  return history.map((message) =>
    secrets.reduce(
      (out, { field, text }) =>
        // Whole words only: "Ada" must not eat the start of "adatta".
        out.replace(
          new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(text)}(?![\\p{L}\\p{N}])`, "giu"),
          `[${field}]`,
        ),
      message,
    ),
  );
}
