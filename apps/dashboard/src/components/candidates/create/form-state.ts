import {
  CANDIDATE_BOOLEAN_FIELD_KEYS,
  CANDIDATE_FIELD_KEYS,
  candidateFieldsSchema,
  isArrayFieldKey,
  type CandidateDraftFields,
  type CandidateFieldKey,
  type CandidateFieldsInput,
} from "@kubri/contracts";
import { toFieldErrors, type FieldErrors } from "@/lib/candidates/field-errors";

export type { FieldErrors };

export type TriState = "" | "true" | "false";

type BooleanKey = (typeof CANDIDATE_BOOLEAN_FIELD_KEYS)[number];

export type FormState = {
  [K in CandidateFieldKey]: K extends BooleanKey
    ? TriState
    : CandidateDraftFields[K] extends string[]
      ? string[]
      : string;
};

function isBooleanKey(key: CandidateFieldKey): key is BooleanKey {
  return (CANDIDATE_BOOLEAN_FIELD_KEYS as readonly string[]).includes(key);
}

export function toFormState(draft: CandidateDraftFields): FormState {
  const out: Record<string, unknown> = {};
  for (const key of CANDIDATE_FIELD_KEYS) {
    const v = draft[key];
    if (isArrayFieldKey(key)) out[key] = [...((v as string[] | null) ?? [])];
    else if (isBooleanKey(key)) out[key] = v === true ? "true" : v === false ? "false" : "";
    else out[key] = (v as string | null) ?? "";
  }
  return out as FormState;
}

/** Form state → the shape `candidateFieldsSchema` parses (server re-validates). */
export function toSubmission(state: FormState): CandidateFieldsInput {
  const out: Record<string, unknown> = {};
  for (const key of CANDIDATE_FIELD_KEYS) {
    const v = state[key];
    if (isArrayFieldKey(key)) out[key] = v as string[];
    else if (isBooleanKey(key)) out[key] = v === "true" ? true : v === "false" ? false : null;
    else out[key] = (v as string).trim() === "" && key !== "firstName" && key !== "lastName" ? null : v;
  }
  return out as CandidateFieldsInput;
}

export function validateFormState(state: FormState): FieldErrors {
  const parsed = candidateFieldsSchema.safeParse(toSubmission(state));
  if (parsed.success) return {};
  return toFieldErrors(parsed.error.issues);
}
