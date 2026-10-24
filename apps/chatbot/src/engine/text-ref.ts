import type { TextValue } from "../campaigns/schema/steps";
import type { LocalizedText } from "../i18n/localized-text";

/**
 * Keys of the system catalog. Plan 05 writes the Italian-first texts under src/i18n; the
 * engine only names them and never resolves a text.
 */
export const SYSTEM_TEXT_KEYS = [
  "system.welcome",
  "system.not_understood",
  "system.generic_error",
  "system.help",
  "system.off_topic",
  "system.progress",
  "system.confirm_value",
  "system.confirm_edit",
  "system.edit_saved",
  "system.edit_cancelled",
  "system.edit_invalid",
  "system.edit_not_allowed",
  "system.post_completion_help",
  "system.cv_requested",
  "system.opt_out_confirm",
  "system.delete_confirm",
  "system.delete_done",
  "system.delete_cancelled",
  "system.stopped",
  "system.closing",
  "system.session_closed",
] as const;
export type SystemTextKey = (typeof SYSTEM_TEXT_KEYS)[number];

export type TextParamValue = string | number | boolean | null | readonly string[];
export type TextParams = Readonly<Record<string, TextParamValue>>;

/** A text to send, by reference: i18n (plan 05) resolves it in the session language. */
export type TextRef =
  /** An entry of the campaign's `texts` map. */
  | { readonly kind: "campaign"; readonly key: string; readonly params?: TextParams }
  /** An inline text of a step; `path` is "stepId", "stepId.questionId" or "stepId.title". */
  | {
      readonly kind: "step";
      readonly path: string;
      readonly text: LocalizedText;
      readonly params?: TextParams;
    }
  | { readonly kind: "system"; readonly key: SystemTextKey; readonly params?: TextParams }
  /** Written by the LLM in the candidate's language (off-topic replies): sent as is. */
  | { readonly kind: "generated"; readonly text: string };

function isRef(value: TextValue): value is { ref: string } {
  return "ref" in value && typeof value.ref === "string";
}

export function stepTextRef(value: TextValue, path: string, params?: TextParams): TextRef {
  if (isRef(value)) {
    return params
      ? { kind: "campaign", key: value.ref, params }
      : { kind: "campaign", key: value.ref };
  }
  return params ? { kind: "step", path, text: value, params } : { kind: "step", path, text: value };
}

/** A stable, log-safe id: never the text itself (generated texts may echo personal data). */
export function describeTextRef(ref: TextRef): string {
  switch (ref.kind) {
    case "campaign":
      return `texts.${ref.key}`;
    case "step":
      return ref.path;
    case "system":
      return ref.key;
    case "generated":
      return "generated";
  }
}

/** Profile values are validated scalars or string lists; anything else is serialized. */
export function toTextParam(value: unknown): TextParamValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) {
    return value;
  }
  return JSON.stringify(value);
}
