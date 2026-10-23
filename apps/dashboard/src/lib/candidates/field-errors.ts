import type { CandidateFieldKey } from "@kubri/contracts";

export type FieldErrors = Partial<Record<CandidateFieldKey, "required" | "invalid">>;

/** Zod issues → one error per field (first issue wins). `too_small` on a string means "required". */
export function toFieldErrors(
  issues: readonly { code: string; path: readonly PropertyKey[] }[],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path[0] as CandidateFieldKey | undefined;
    if (!key || errors[key]) continue;
    errors[key] = issue.code === "too_small" ? "required" : "invalid";
  }
  return errors;
}
