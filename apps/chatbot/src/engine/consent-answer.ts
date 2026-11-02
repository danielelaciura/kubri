import type { ConsentStep } from "../campaigns/schema/steps";
import { consentTextRef, followOutcome } from "./advance";
import { chosen } from "./choice-answers";
import type { Interpretation } from "./interpretation";
import { applyExtractedPatch } from "./patches";
import { nonAnswer } from "./replies";
import { emit, incoherent, say, setState, systemText, type Turn } from "./turn";

/**
 * D145: unclear answers in a row on a consent step (state.clarifications, reset when the step
 * is entered) that still get the full consent text again; from the next one, a short hint.
 */
export const CONSENT_MAX_UNCLEAR = 3;

/**
 * Spec §7.3: blocking; recorded only once answered, with the text shown. The optional
 * `kubri_global` consent (D48) is recorded like any other: runtime maps its outcome to
 * `sharedWithGlobal`, and it never moves the threshold.
 */
export function answerConsent(
  turn: Turn,
  index: number,
  step: ConsentStep,
  interpretation: Interpretation,
): void {
  const outcome = chosen(interpretation);
  if (outcome !== "accepted" && outcome !== "declined") {
    applyExtractedPatch(turn, interpretation.patch, undefined);
    unclearConsent(turn, interpretation);
    return;
  }
  const language = turn.state.language ?? incoherent("consent answered before the language");
  emit(turn, {
    type: "RecordConsent",
    stepId: step.id,
    consentKey: step.consentKey,
    textVersion: step.textVersion,
    text: consentTextRef(turn, step),
    ...(step.link ? { link: step.link } : {}),
    dataController: turn.campaign.dataController,
    language,
    outcome,
    at: turn.at,
  });
  if (!step.optional) updateThreshold(turn, outcome);
  // The turn's data is applied only now: data given together with the accepted mandatory
  // consent is kept (the consent is given in that same message), and the next block skips the
  // questions it answers. Before the threshold, or after a decline, it is still dropped.
  applyExtractedPatch(turn, interpretation.patch, undefined);
  followOutcome(turn, index, outcome, outcome === "declined" ? "consent_declined" : "flow_stop");
}

/**
 * Spec D24, D38, D48: the threshold is the campaign's single mandatory consent. Accepting it
 * crosses the threshold once; declining it (even when asked again) resets it before the stop.
 */
function updateThreshold(turn: Turn, outcome: "accepted" | "declined"): void {
  if (outcome === "declined") {
    setState(turn, { consentsAccepted: false });
    return;
  }
  if (turn.state.consentsAccepted) return;
  setState(turn, { consentsAccepted: true });
  // The candidate exists on the Kubri platform from here on (spec §12.1).
  emit(turn, { type: "EnqueueJob", job: { name: "kubri-webhook", event: "consents.accepted" } });
}

/**
 * D145: not an answer to a consent step (not understood, off topic, no choice). Up to
 * CONSENT_MAX_UNCLEAR the lead text and the full consent text again, as any non-answer; then
 * only a short hint, the turn's last message so it carries the Accetto / Non accetto buttons
 * (D112), and the first time a flag. The consent stays blocking: nothing is recorded.
 */
export function unclearConsent(turn: Turn, interpretation: Interpretation | null): void {
  const count = turn.state.clarifications + 1;
  setState(turn, { clarifications: count });
  if (count <= CONSENT_MAX_UNCLEAR) {
    nonAnswer(turn, interpretation);
    return;
  }
  if (count === CONSENT_MAX_UNCLEAR + 1) {
    emit(turn, { type: "FlagSession", reason: "consent_unclear", needsAttention: false });
  }
  say(turn, systemText("consent.answer_hint"));
}
