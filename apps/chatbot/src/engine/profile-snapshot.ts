/** Spec §6: state kept next to each value. */
export type FieldStatus = "confirmed" | "inferred" | "unresolved";

export interface FieldState {
  readonly value: unknown;
  readonly confidence: number;
  readonly status: FieldStatus;
}

/** Field ref ("firstName", "custom.x") → state. Flat, like the profile itself (D25). */
export type ProfileSnapshot = Readonly<Record<string, FieldState>>;

/** Below this an extracted value is not saved: the engine asks for a confirmation (D34). */
export const CONFIDENCE_THRESHOLD = 0.7;

export function fieldState(profile: ProfileSnapshot, field: string): FieldState | undefined {
  return Object.hasOwn(profile, field) ? profile[field] : undefined;
}

/** "Already filled with sufficient confidence" (spec §5.3). */
export function isFieldFilled(profile: ProfileSnapshot, field: string): boolean {
  const state = fieldState(profile, field);
  return (
    state !== undefined && state.status !== "unresolved" && state.confidence >= CONFIDENCE_THRESHOLD
  );
}

/** Filled, or given up on (unresolved): either way the question is not asked again. */
export function isFieldSettled(profile: ProfileSnapshot, field: string): boolean {
  return isFieldFilled(profile, field) || fieldState(profile, field)?.status === "unresolved";
}

/** The values conditions are evaluated on. */
export function profileValues(profile: ProfileSnapshot): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [field, state] of Object.entries(profile)) {
    if (state.status !== "unresolved") values[field] = state.value;
  }
  return values;
}

export function withField(
  profile: ProfileSnapshot,
  field: string,
  state: FieldState,
): ProfileSnapshot {
  return { ...profile, [field]: state };
}
