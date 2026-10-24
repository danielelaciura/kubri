import { isDeepStrictEqual } from "node:util";
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
  readonly accepted: readonly PatchEntry[];
  readonly rejected: readonly RejectedPatchEntry[];
}

/** Rejections are logged: never echo unbounded LLM text. */
const MAX_REJECTED_FIELD_LENGTH = 64;

function rejection(field: string, reason: PatchRejectionReason): RejectedPatchEntry {
  return { field: field.slice(0, MAX_REJECTED_FIELD_LENGTH), reason };
}

/**
 * Entries are checked one by one; then valid entries for the same field are merged: identical
 * values collapse into the entry with the highest confidence, conflicting ones are all rejected.
 */
export function validatePatch(
  entries: readonly PatchEntry[],
  customFields: readonly CustomFieldDefinition[],
): PatchValidationResult {
  const rejected: RejectedPatchEntry[] = [];
  const valid: { index: number; entry: PatchEntry }[] = [];

  entries.forEach((e, index) => {
    const reason = rejectionReason(e, customFields);
    if (reason) {
      rejected.push(rejection(e.field, reason));
      return;
    }
    const def = resolveField(e.field, customFields);
    // def is defined here: rejectionReason returned undefined.
    const parsed = def ? valueSchemaFor(def).safeParse(e.value) : undefined;
    if (!parsed?.success) {
      rejected.push(rejection(e.field, "invalid_value"));
      return;
    }
    valid.push({ index, entry: { ...e, value: parsed.data } });
  });

  const byField = new Map<string, { index: number; entry: PatchEntry }[]>();
  for (const item of valid) {
    byField.set(item.entry.field, [...(byField.get(item.entry.field) ?? []), item]);
  }

  const kept: { index: number; entry: PatchEntry }[] = [];
  for (const group of byField.values()) {
    const [first, ...rest] = group;
    if (!first) continue;
    if (rest.some((item) => !isDeepStrictEqual(item.entry.value, first.entry.value))) {
      for (const item of group) rejected.push(rejection(item.entry.field, "duplicate_field"));
      continue;
    }
    const best = group.reduce((a, b) => (b.entry.confidence > a.entry.confidence ? b : a));
    kept.push({ index: first.index, entry: best.entry });
  }

  kept.sort((a, b) => a.index - b.index);
  return { accepted: kept.map((item) => item.entry), rejected };
}

function rejectionReason(
  e: PatchEntry,
  customFields: readonly CustomFieldDefinition[],
): PatchRejectionReason | undefined {
  if (!(e.confidence >= 0 && e.confidence <= 1)) return "invalid_confidence";
  const def = resolveField(e.field, customFields);
  if (!def) return "unknown_field";
  if (def.systemOnly === true) return "system_only_field";
  return undefined;
}
