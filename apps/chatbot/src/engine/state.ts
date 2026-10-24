import type { ConditionContext } from "../campaigns/conditions/evaluate";
import type { LanguageCode } from "../i18n/localized-text";
import { profileValues, type ProfileSnapshot } from "./profile-snapshot";

export type Phase = "language" | "flow" | "post_completion" | "closed";

/** A low-confidence extracted value waiting for a yes/no (spec §7.2 point 2). */
export interface ValueConfirmation {
  readonly kind: "value";
  readonly field: string;
  readonly value: unknown;
  readonly confidence: number;
}

/** An edit waiting for a yes/no, with the old and the new value (spec §5.7). */
export interface EditConfirmation {
  readonly kind: "edit";
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

/** A data-deletion request waiting for a yes/no (owner decision, plan 04 Task 21). */
export interface DeleteConfirmation {
  readonly kind: "delete_data";
}

export type PendingConfirmation = ValueConfirmation | EditConfirmation | DeleteConfirmation;

/** Spec §7.1. Serializable: runtime stores it as Session.engineState (plan 08). */
export interface SessionState {
  readonly phase: Phase;
  /**
   * The step waiting for an answer. In post_completion: the cv_offer step while a CV
   * regeneration is being offered (D44), otherwise null.
   */
  readonly stepId: string | null;
  readonly questionId: string | null;
  /** Clarifications already asked for the current question. */
  readonly clarifications: number;
  readonly pendingConfirmation: PendingConfirmation | null;
  /** Outcome of each completed step. Skipped steps have none. */
  readonly outcomes: Readonly<Record<string, string>>;
  readonly language: LanguageCode | null;
  /** Spec D24 threshold: a mandatory consent accepted and none declined (D38). */
  readonly consentsAccepted: boolean;
  /**
   * The profile as the engine sees it. CandidateProfile stays the source of truth: runtime
   * hydrates this before step() and saves the ApplyPatch effects back (D31).
   */
  readonly profile: ProfileSnapshot;
}

export function initialSessionState(): SessionState {
  return {
    phase: "language",
    stepId: null,
    questionId: null,
    clarifications: 0,
    pendingConfirmation: null,
    outcomes: {},
    language: null,
    consentsAccepted: false,
    profile: {},
  };
}

export function conditionContext(state: SessionState): ConditionContext {
  return { values: profileValues(state.profile), outcomes: state.outcomes };
}
