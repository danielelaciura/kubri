import { describe, expect, it } from "vitest";
import type { CampaignInput } from "../../../src/campaigns/schema/campaign";
import { CONSENT_MAX_UNCLEAR } from "../../../src/engine/consent-answer";
import type { Interpretation } from "../../../src/engine/interpretation";
import type { SessionState } from "../../../src/engine/state";
import { step, type StepResult } from "../../../src/engine/step";
import { AT, campaign, choice, flowState, interpretation, others, sent, userTurn } from "./helpers";

const atPrivacy = flowState({ stepId: "privacy", outcomes: { intro: "next", cv_info: "yes" } });

/** D48: the only consent besides the mandatory one is the optional `kubri_global`. */
const withKubriGlobal =
  (at: number) =>
  (input: CampaignInput): void => {
    input.flow.splice(at, 0, {
      id: "kubri",
      type: "consent",
      consentKey: "kubri_global",
      textVersion: "2026-10",
      text: { it: "Vuoi che il tuo profilo sia visibile ad altre aziende?" },
      optional: true,
    });
  };

describe("consent answers", () => {
  it("records an accepted mandatory consent and crosses the threshold", () => {
    const result = step(atPrivacy, userTurn("accetto", choice("accepted")), campaign());

    expect(result.effects[0]).toEqual({
      type: "RecordConsent",
      stepId: "privacy",
      consentKey: "acme_privacy",
      textVersion: "2026-10",
      text: {
        kind: "step",
        path: "privacy",
        text: { it: "Accetti l'informativa sulla privacy?" },
        params: {
          "dataController.name": "ACME S.r.l.",
          "dataController.privacyUrl": "https://example.com/privacy",
          link: "https://example.com/privacy",
        },
      },
      link: "https://example.com/privacy",
      dataController: { name: "ACME S.r.l.", privacyUrl: "https://example.com/privacy" },
      language: "it",
      outcome: "accepted",
      at: AT,
    });
    expect(others(result.effects)).toEqual([
      "RecordConsent:acme_privacy:accepted",
      "EnqueueJob:kubri-webhook:consents.accepted",
    ]);
    expect(sent(result.effects)).toEqual(["system.progress", "anagrafica.nome"]);
    expect(result.state.consentsAccepted).toBe(true);
  });

  it("keeps data given together with the accepted consent, after the crossing", () => {
    const interp = interpretation({
      intent: "choice",
      choice: "accepted",
      patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
    });
    const result = step(atPrivacy, userTurn("sì, mi chiamo Mario", interp), campaign());

    expect(others(result.effects)).toEqual([
      "RecordConsent:acme_privacy:accepted",
      "EnqueueJob:kubri-webhook:consents.accepted",
      "ApplyPatch:extraction:firstName",
    ]);
    expect(sent(result.effects)).toEqual(["system.progress", "anagrafica.patente"]);
    expect(result.state.profile.firstName?.value).toBe("Mario");
  });

  it("drops data given with a declined consent", () => {
    const interp = interpretation({
      intent: "choice",
      choice: "declined",
      patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
    });
    const result = step(atPrivacy, userTurn("no, sono Mario", interp), campaign());

    expect(others(result.effects)).not.toContain("ApplyPatch:extraction:firstName");
    expect(result.state.profile).toEqual({});
  });

  it("drops data given before the consent is answered", () => {
    const interp = interpretation({
      patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
    });
    const result = step(atPrivacy, userTurn("mi chiamo Mario", interp), campaign());

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["system.not_understood", "privacy"]);
  });

  it("reports flow_stop, not consent_declined, when an accepted consent leads to @stop", () => {
    const stopOnAccept = campaign((input) => {
      const privacy = input.flow[2];
      if (privacy?.type !== "consent") throw new Error("privacy is not a consent");
      privacy.on = { accepted: "@stop" };
    });
    const result = step(atPrivacy, userTurn("accetto", choice("accepted")), stopOnAccept);

    expect(others(result.effects)).toContain("StopSession:flow_stop:keep");
  });

  it("stops and deletes on a declined mandatory consent", () => {
    const result = step(atPrivacy, userTurn("no", choice("declined")), campaign());

    expect(others(result.effects)).toEqual([
      "RecordConsent:acme_privacy:declined",
      "StopSession:consent_declined:delete",
    ]);
    expect(sent(result.effects)).toEqual(["system.stopped"]);
    expect(result.state).toMatchObject({ phase: "closed", consentsAccepted: false });
  });

  it("asks again without recording anything when the answer is not a consent choice", () => {
    const result = step(atPrivacy, userTurn("chi siete?", interpretation()), campaign());

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["system.not_understood", "privacy"]);
  });

  it("a mandatory consent declined when asked again resets the threshold, so data is deleted despite onStop keep (D38)", () => {
    const c = campaign((input) => {
      input.onStop = { data: "keep" };
    });
    const result = step(
      { ...atPrivacy, consentsAccepted: true },
      userTurn("no", choice("declined")),
      c,
    );

    expect(others(result.effects)).toEqual([
      "RecordConsent:acme_privacy:declined",
      "StopSession:consent_declined:delete",
    ]);
    expect(result.state.consentsAccepted).toBe(false);
  });

  describe("the optional kubri_global consent (D48)", () => {
    it("continues on a decline, threshold unchanged", () => {
      const result = step(
        flowState({ stepId: "kubri", consentsAccepted: true }),
        userTurn("no", choice("declined")),
        campaign(withKubriGlobal(3)),
      );

      expect(others(result.effects)).toEqual(["RecordConsent:kubri_global:declined"]);
      expect(sent(result.effects)).toEqual(["system.progress", "anagrafica.nome"]);
      expect(result.state.consentsAccepted).toBe(true);
    });

    it("does not send consents.accepted again when accepted after the threshold", () => {
      const result = step(
        flowState({ stepId: "kubri", consentsAccepted: true }),
        userTurn("sì", choice("accepted")),
        campaign(withKubriGlobal(3)),
      );

      expect(others(result.effects)).toEqual(["RecordConsent:kubri_global:accepted"]);
      expect(result.state.consentsAccepted).toBe(true);
    });

    it("never crosses the threshold on its own", () => {
      const result = step(
        flowState({ stepId: "kubri", outcomes: { intro: "next", cv_info: "yes" } }),
        userTurn("sì", choice("accepted")),
        campaign(withKubriGlobal(2)),
      );

      expect(others(result.effects)).toEqual(["RecordConsent:kubri_global:accepted"]);
      expect(sent(result.effects)).toEqual(["privacy"]);
      expect(result.state.consentsAccepted).toBe(false);
    });
  });

  describe("unclear answers (D145)", () => {
    const c = campaign();
    const unclear = interpretation({ intent: "unclear" });

    /** The state after `n` unclear answers on the mandatory consent. */
    function afterUnclear(n: number): SessionState {
      let state = atPrivacy;
      for (let i = 0; i < n; i += 1) state = step(state, userTurn("boh", unclear), c).state;
      return state;
    }

    const answer = (state: SessionState, interp: Interpretation | null, text = "boh"): StepResult =>
      step(state, userTurn(text, interp), c);

    it("caps at three", () => {
      expect(CONSENT_MAX_UNCLEAR).toBe(3);
    });

    it("asks with the full consent text up to the limit, counting each answer", () => {
      for (let n = 0; n < CONSENT_MAX_UNCLEAR; n += 1) {
        const result = answer(afterUnclear(n), unclear);

        expect(sent(result.effects)).toEqual(["system.not_understood", "privacy"]);
        expect(others(result.effects)).toEqual([]);
        expect(result.state.clarifications).toBe(n + 1);
      }
    });

    it("past the limit sends only the short hint, last (it carries the buttons), and flags once", () => {
      const result = answer(afterUnclear(CONSENT_MAX_UNCLEAR), unclear);

      expect(sent(result.effects)).toEqual(["consent.answer_hint"]);
      expect(result.effects).toContainEqual({
        type: "FlagSession",
        reason: "consent_unclear",
        needsAttention: false,
      });
      expect(result.effects.at(-1)).toEqual({
        type: "SendText",
        text: { kind: "system", key: "consent.answer_hint" },
      });
      expect(result.state).toMatchObject({ stepId: "privacy", consentsAccepted: false });
    });

    it("keeps sending the hint without flagging again", () => {
      const result = answer(afterUnclear(CONSENT_MAX_UNCLEAR + 1), unclear);

      expect(sent(result.effects)).toEqual(["consent.answer_hint"]);
      expect(others(result.effects)).toEqual([]);
    });

    it("still records the consent once the candidate accepts", () => {
      const result = answer(afterUnclear(CONSENT_MAX_UNCLEAR + 2), choice("accepted"), "accetto");

      expect(others(result.effects)).toEqual([
        "RecordConsent:acme_privacy:accepted",
        "EnqueueJob:kubri-webhook:consents.accepted",
      ]);
      expect(result.state).toMatchObject({ consentsAccepted: true, clarifications: 0 });
    });

    it("caps off-topic messages and turns without an interpretation too", () => {
      const offTopic = interpretation({ intent: "off_topic", offTopicReply: "Parliamo d'altro" });

      expect(sent(answer(afterUnclear(CONSENT_MAX_UNCLEAR), offTopic).effects)).toEqual([
        "consent.answer_hint",
      ]);
      expect(sent(answer(afterUnclear(CONSENT_MAX_UNCLEAR), null).effects)).toEqual([
        "consent.answer_hint",
      ]);
      expect(answer(afterUnclear(1), offTopic).state.clarifications).toBe(2);
      expect(answer(afterUnclear(1), null).state.clarifications).toBe(2);
    });

    it("answers help with the full consent text, past the limit and without counting it", () => {
      const result = answer(
        afterUnclear(CONSENT_MAX_UNCLEAR + 1),
        interpretation({ intent: "help" }),
      );

      expect(sent(result.effects)).toEqual(["system.help", "privacy"]);
      expect(others(result.effects)).toEqual([]);
      expect(result.state.clarifications).toBe(CONSENT_MAX_UNCLEAR + 1);
    });

    it("still stops or asks to delete the data past the limit", () => {
      const state = afterUnclear(CONSENT_MAX_UNCLEAR + 1);

      expect(others(answer(state, null, "stop").effects)).toContain("OptOut");
      expect(sent(answer(state, null, "cancella i miei dati").effects)).toEqual([
        "system.delete_confirm",
      ]);
    });

    it("drops data given with an unclear answer past the limit", () => {
      const interp = interpretation({
        patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
      });
      const result = answer(afterUnclear(CONSENT_MAX_UNCLEAR), interp, "mi chiamo Mario");

      expect(others(result.effects)).toEqual(["FlagSession:consent_unclear"]);
      expect(result.state.profile).toEqual({});
    });
  });
});
