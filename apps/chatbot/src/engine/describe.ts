import type { RejectedPatchEntry } from "../profile/patch";
import type { Effect } from "./effects";
import { describeTextRef } from "./text-ref";

/** A compact, log-safe description of an effect: ids and field names, never values. */
export function describeEffect(effect: Effect): string {
  switch (effect.type) {
    case "SendText":
      return `SendText:${describeTextRef(effect.text)}`;
    case "ApplyPatch":
      return `ApplyPatch:${effect.source}:${effect.fields.map((f) => f.field).join(",")}`;
    case "RecordPatchRejections":
      return `RecordPatchRejections:${effect.rejected.map(describeRejection).join(",")}`;
    case "MarkFieldUnresolved":
      return `MarkFieldUnresolved:${effect.field}`;
    case "RecordConsent":
      return `RecordConsent:${effect.consentKey}:${effect.outcome}`;
    case "SetLanguage":
      return `SetLanguage:${effect.language}`;
    case "CompleteSession":
      return "CompleteSession";
    case "StopSession":
      return `StopSession:${effect.reason}:${effect.dataPolicy}`;
    case "OptOut":
      return "OptOut";
    case "EnqueueJob":
      return effect.job.name === "kubri-webhook"
        ? `EnqueueJob:kubri-webhook:${effect.job.event}`
        : `EnqueueJob:${effect.job.name}`;
    case "FlagSession":
      return effect.field
        ? `FlagSession:${effect.reason}:${effect.field}`
        : `FlagSession:${effect.reason}`;
  }
}

/** An unknown field name is free text written by the LLM: it may echo personal data. */
function describeRejection(r: RejectedPatchEntry): string {
  return `${r.reason === "unknown_field" ? "<unknown>" : r.field}=${r.reason}`;
}
