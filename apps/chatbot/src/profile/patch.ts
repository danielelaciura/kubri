import type { CustomFieldDefinition } from "./custom-fields";
import { resolveField } from "./field-ref";
import { valueSchemaFor } from "./field-value";

export interface PatchEntry {
  readonly field: string;
  readonly value: unknown;
  /** 0..1, as estimated by the LLM. */
  readonly confidence: number;
  /** The part of the candidate's message the value comes from. */
  readonly evidence: string;
}

export type PatchRejectionReason =
  | "unknown_field"
  | "system_only_field"
  | "invalid_value"
  | "invalid_confidence"
  | "duplicate_field";

/** Carries no value on purpose: rejections are logged and values are personal data. */
export interface RejectedPatchEntry {
  readonly field: string;
  readonly reason: PatchRejectionReason;
}

export interface PatchValidationResult {
  readonly accepted: PatchEntry[];
  readonly rejected: RejectedPatchEntry[];
}

export function validatePatch(
  entries: readonly PatchEntry[],
  customFields: readonly CustomFieldDefinition[],
): PatchValidationResult {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.field, (counts.get(e.field) ?? 0) + 1);

  const accepted: PatchEntry[] = [];
  const rejected: RejectedPatchEntry[] = [];

  for (const e of entries) {
    const reason = rejectionReason(e, counts, customFields);
    if (reason) {
      rejected.push({ field: e.field, reason });
      continue;
    }
    const def = resolveField(e.field, customFields);
    // def is defined here: rejectionReason returned undefined.
    const parsed = def ? valueSchemaFor(def).safeParse(e.value) : undefined;
    if (!parsed?.success) {
      rejected.push({ field: e.field, reason: "invalid_value" });
      continue;
    }
    accepted.push({ ...e, value: parsed.data });
  }

  return { accepted, rejected };
}

function rejectionReason(
  e: PatchEntry,
  counts: ReadonlyMap<string, number>,
  customFields: readonly CustomFieldDefinition[],
): PatchRejectionReason | undefined {
  if ((counts.get(e.field) ?? 0) > 1) return "duplicate_field";
  if (!(e.confidence >= 0 && e.confidence <= 1)) return "invalid_confidence";
  const def = resolveField(e.field, customFields);
  if (!def) return "unknown_field";
  if (def.systemOnly === true) return "system_only_field";
  return undefined;
}
