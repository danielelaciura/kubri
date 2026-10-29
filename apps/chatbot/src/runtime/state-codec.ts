import { z } from "zod";
import type { ProfileSnapshot } from "../engine/profile-snapshot";
import type { PendingConfirmation, SessionState } from "../engine/state";
import { LanguageCodeSchema } from "../i18n/localized-text";
import { StoredDataError } from "./stored-data-error";

/**
 * Format of Session.engineState. Bump it when the shape changes incompatibly; additions
 * do not need a bump: they get a default below, so older rows still decode.
 */
export const STATE_FORMAT_VERSION = 1;

// Extra keys are stripped, not refused: a row written by a newer release (or before a field
// was removed) must still be readable after a deploy or a rollback.
const PendingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("value"),
    field: z.string(),
    value: z.unknown(),
    confidence: z.number(),
  }),
  z.object({
    kind: z.literal("edit"),
    field: z.string(),
    oldValue: z.unknown(),
    newValue: z.unknown(),
  }),
  z.object({ kind: z.literal("delete_data") }),
]);

/** SessionState without `profile` (D104). Only `phase` has no safe default. */
const PersistedStateSchema = z.object({
  /** Absent in rows written before the version existed (legacy = 1). */
  v: z.number().int().positive().optional(),
  phase: z.enum(["language", "flow", "post_completion", "closed"]),
  stepId: z.string().nullable().default(null),
  questionId: z.string().nullable().default(null),
  clarifications: z.number().int().min(0).default(0),
  // Read on its own: an unknown or broken confirmation is dropped, not fatal.
  pendingConfirmation: z.unknown().optional(),
  outcomes: z.record(z.string(), z.string()).default({}),
  language: LanguageCodeSchema.nullable().default(null),
  consentsAccepted: z.boolean().default(false),
});

/** What is written to Session.engineState. */
export type PersistedState = Omit<SessionState, "profile"> & { readonly v: number };

export interface DecodeOptions {
  /**
   * Called with the path of a part that could not be read and was dropped (never its value):
   * the caller logs it with the ids and may flag the session.
   */
  readonly onDropped?: (path: string) => void;
}

function pending(json: unknown, options: DecodeOptions): PendingConfirmation | null {
  if (json === undefined || json === null) return null;
  const result = PendingSchema.safeParse(json);
  if (!result.success) {
    options.onDropped?.("pendingConfirmation");
    return null;
  }
  const p = result.data;
  switch (p.kind) {
    case "value":
      return { kind: "value", field: p.field, value: p.value, confidence: p.confidence };
    case "edit":
      return { kind: "edit", field: p.field, oldValue: p.oldValue, newValue: p.newValue };
    case "delete_data":
      return { kind: "delete_data" };
  }
}

/** The profile is CandidateProfile's job: it never goes into engineState (D104). */
export function encodeState(state: SessionState): PersistedState {
  const { profile: _profile, ...rest } = state;
  return { v: STATE_FORMAT_VERSION, ...rest };
}

/** Throws only when the state as a whole is unusable (not an object, no valid phase…). */
export function decodeState(
  json: unknown,
  profile: ProfileSnapshot,
  options: DecodeOptions = {},
): SessionState {
  const result = PersistedStateSchema.safeParse(json);
  if (!result.success) throw new StoredDataError("the stored engine state cannot be read");
  const { v: _v, pendingConfirmation, ...state } = result.data;
  return { ...state, pendingConfirmation: pending(pendingConfirmation, options), profile };
}

/**
 * D109: a confirmation still pending carries personal values (value, oldValue, newValue), so
 * the purge of a session drops it. A state that cannot be read loses the key all the same.
 */
export function withoutPendingConfirmation(json: unknown): unknown {
  if (PersistedStateSchema.safeParse(json).success) {
    return encodeState({ ...decodeState(json, {}), pendingConfirmation: null });
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return json;
  const { pendingConfirmation: _dropped, ...rest } = json as Record<string, unknown>;
  return rest;
}
