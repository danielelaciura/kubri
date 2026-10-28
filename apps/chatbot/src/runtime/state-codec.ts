import { z } from "zod";
import type { ProfileSnapshot } from "../engine/profile-snapshot";
import type { PendingConfirmation, SessionState } from "../engine/state";
import { LanguageCodeSchema } from "../i18n/localized-text";

const PendingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("value"),
    field: z.string(),
    value: z.unknown(),
    confidence: z.number(),
  }),
  z.strictObject({
    kind: z.literal("edit"),
    field: z.string(),
    oldValue: z.unknown(),
    newValue: z.unknown(),
  }),
  z.strictObject({ kind: z.literal("delete_data") }),
]);

/** SessionState without `profile` (D104). */
const PersistedStateSchema = z.strictObject({
  phase: z.enum(["language", "flow", "post_completion", "closed"]),
  stepId: z.string().nullable(),
  questionId: z.string().nullable(),
  clarifications: z.number().int().min(0),
  pendingConfirmation: PendingSchema.nullable(),
  outcomes: z.record(z.string(), z.string()),
  language: LanguageCodeSchema.nullable(),
  consentsAccepted: z.boolean(),
});
export type PersistedState = z.infer<typeof PersistedStateSchema>;

function pending(p: z.infer<typeof PendingSchema> | null): PendingConfirmation | null {
  if (p === null) return null;
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
  return rest;
}

export function decodeState(json: unknown, profile: ProfileSnapshot): SessionState {
  const result = PersistedStateSchema.safeParse(json);
  if (!result.success) throw new Error("the stored engine state cannot be read");
  const state = result.data;
  return { ...state, pendingConfirmation: pending(state.pendingConfirmation), profile };
}
