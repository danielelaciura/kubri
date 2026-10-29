import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { LanguageCode } from "../i18n/localized-text";
import type { RejectedPatchEntry } from "../profile/patch";
import type { TextRef } from "./text-ref";

/** Events sent to the Kubri platform (spec §12.1). `cv.generated` is sent by the cv job. */
export type KubriEvent =
  "consents.accepted" | "block.completed" | "interview.completed" | "profile.updated";

export type Job =
  | { readonly name: "kubri-webhook"; readonly event: KubriEvent }
  | { readonly name: "cv" }
  | { readonly name: "geocoding" }
  | { readonly name: "delete-contact" };

/** "clarify": targeted follow-up on what is missing; "rephrase": the same question, reworded. */
export type SendPurpose = "clarify" | "rephrase";
export type PatchSource = "extraction" | "edit";
export type DataPolicy = "delete" | "keep";
export type StopReason =
  | "consent_declined"
  | "terminated"
  | "flow_stop"
  | "ended_before_consent"
  | "opt_out"
  | "delete_data";
export type FlagReason =
  | "unresolved_field"
  | "auto_advance_limit"
  | "incoherent_state"
  | "outbound_failed"
  | "stale_confirmation";

export interface AppliedField {
  readonly field: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly status: "confirmed" | "inferred";
}

/** Effects are data (spec §7.1): runtime (plan 08) executes them in order, in one transaction. */
export type Effect =
  | { readonly type: "SendText"; readonly text: TextRef; readonly purpose?: SendPurpose }
  | {
      readonly type: "ApplyPatch";
      readonly source: PatchSource;
      readonly fields: readonly AppliedField[];
    }
  /** Invalid extracted values: logged without the value (spec §8.4). */
  | { readonly type: "RecordPatchRejections"; readonly rejected: readonly RejectedPatchEntry[] }
  | { readonly type: "MarkFieldUnresolved"; readonly field: string }
  | {
      readonly type: "RecordConsent";
      readonly stepId: string;
      readonly consentKey: string;
      readonly textVersion: string;
      /** The text shown, by reference: runtime stores the resolved copy (spec §7.3). */
      readonly text: TextRef;
      readonly link?: string;
      readonly dataController: CampaignDefinition["dataController"];
      readonly language: LanguageCode;
      readonly outcome: "accepted" | "declined";
      readonly at: string;
    }
  | { readonly type: "SetLanguage"; readonly language: LanguageCode }
  | { readonly type: "CompleteSession"; readonly at: string }
  | {
      readonly type: "StopSession";
      readonly reason: StopReason;
      readonly dataPolicy: DataPolicy;
      readonly at: string;
    }
  /** Records the opt-out on the contact's channel state. */
  | { readonly type: "OptOut"; readonly at: string }
  | { readonly type: "EnqueueJob"; readonly job: Job }
  /** needsAttention moves the session to `needs_attention` (spec §13). */
  | {
      readonly type: "FlagSession";
      readonly reason: FlagReason;
      readonly needsAttention: boolean;
      readonly field?: string;
    };
