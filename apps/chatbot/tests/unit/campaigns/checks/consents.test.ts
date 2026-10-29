import { describe, expect, it } from "vitest";
import { checkConsents } from "../../../../src/campaigns/checks/consents";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkConsents", () => {
  it("passes on the minimal campaign", () => {
    expect(checkConsents(parsed(minimalCampaign()))).toEqual([]);
  });

  it("requires the kubri_global consent to be optional", () => {
    const input = minimalCampaign();
    input.flow.splice(4, 0, {
      id: "kubri_consent",
      type: "consent",
      consentKey: "kubri_global",
      textVersion: "2026-10",
      text: { it: "Vuoi che il tuo profilo sia visibile ad altre aziende?" },
    });

    expect(
      checkConsents(parsed(input)).filter((i) => i.code === "kubri_global_not_optional"),
    ).toEqual([
      {
        path: "flow[4].optional",
        code: "kubri_global_not_optional",
        message: "The kubri_global consent must be optional (spec §7.3)",
      },
    ]);
  });

  it("requires kubri_global to come after the mandatory consent (D54)", () => {
    const input = minimalCampaign();
    input.flow.splice(2, 0, {
      id: "kubri_consent",
      type: "consent",
      consentKey: "kubri_global",
      textVersion: "2026-10",
      text: { it: "Vuoi che il tuo profilo sia visibile ad altre aziende?" },
      optional: true,
    });

    expect(
      checkConsents(parsed(input)).filter(
        (i) => i.code === "kubri_global_before_mandatory_consent",
      ),
    ).toEqual([
      {
        path: "flow[2]",
        code: "kubri_global_before_mandatory_consent",
        message:
          'The kubri_global consent "kubri_consent" must come after the mandatory consent in the flow',
      },
    ]);
  });

  it("accepts kubri_global after the mandatory consent", () => {
    const input = minimalCampaign();
    input.flow.splice(3, 0, {
      id: "kubri_consent",
      type: "consent",
      consentKey: "kubri_global",
      textVersion: "2026-10",
      text: { it: "Vuoi che il tuo profilo sia visibile ad altre aziende?" },
      optional: true,
    });

    expect(checkConsents(parsed(input))).toEqual([]);
  });

  it("allows only one mandatory consent (spec D48)", () => {
    const input = minimalCampaign();
    input.flow.splice(3, 0, {
      id: "second_privacy",
      type: "consent",
      consentKey: "acme_health",
      textVersion: "2026-10",
      text: { it: "Accetti il trattamento dei dati sulla salute?" },
    });

    expect(
      checkConsents(parsed(input)).filter((i) => i.code === "multiple_mandatory_consents"),
    ).toEqual([
      {
        path: "flow[3].optional",
        code: "multiple_mandatory_consents",
        message:
          'Step "second_privacy" is a second mandatory consent: a campaign has exactly one (the only other consent is the optional kubri_global)',
      },
    ]);
  });

  it("requires at least one mandatory consent (spec D24 threshold)", () => {
    const input = minimalCampaign();
    input.flow.splice(2, 1, {
      id: "privacy",
      type: "consent",
      consentKey: "acme_privacy",
      textVersion: "2026-10",
      text: { it: "Accetti l'informativa sulla privacy?" },
      optional: true,
    });

    expect(
      checkConsents(parsed(input)).filter((i) => i.code === "missing_mandatory_consent"),
    ).toEqual([
      {
        path: "flow",
        code: "missing_mandatory_consent",
        message:
          "The flow needs at least one mandatory consent step (optional: false): without it the consent threshold is never crossed",
      },
    ]);
  });

  it("reports a campaign with no consent step at all", () => {
    const input = minimalCampaign();
    input.flow.splice(2, 1);

    expect(checkConsents(parsed(input)).map((i) => [i.path, i.code])).toEqual([
      ["flow", "missing_mandatory_consent"],
      ["flow[2]", "data_before_mandatory_consent"],
    ]);
  });

  it("forbids `when` on a mandatory consent step", () => {
    const input = minimalCampaign();
    input.flow[2] = {
      id: "privacy",
      type: "consent",
      consentKey: "acme_privacy",
      textVersion: "2026-10",
      text: { it: "Accetti l'informativa sulla privacy?" },
      when: { field: "drivingLicense", eq: true },
    };

    expect(checkConsents(parsed(input))).toEqual([
      {
        path: "flow[2].when",
        code: "conditional_mandatory_consent",
        message:
          'Mandatory consent step "privacy" cannot have a `when` condition: it could be skipped',
      },
    ]);
  });

  it("allows `when` on an optional consent step", () => {
    const input = minimalCampaign();
    input.flow.splice(3, 0, {
      id: "marketing",
      type: "consent",
      consentKey: "acme_marketing",
      textVersion: "2026-10",
      text: { it: "Posso contattarti per altre offerte?" },
      optional: true,
      when: { field: "drivingLicense", eq: true },
    });

    expect(checkConsents(parsed(input))).toEqual([]);
  });

  it("reports data collection reachable around a mandatory consent", () => {
    const input = minimalCampaign();
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "Sai cos'è un CV?" },
      options: [
        { id: "yes", description: "sì" },
        { id: "no", description: "no" },
        { id: "idk", description: "non so" },
      ],
      on: { yes: "anagrafica", no: "@stop", idk: "privacy" },
    };

    expect(checkConsents(parsed(input))).toEqual([
      {
        path: "flow[3]",
        code: "data_before_mandatory_consent",
        message:
          'Step "anagrafica" (questions) can be reached without passing through a mandatory consent',
      },
    ]);
  });

  it("reports data collection placed before the mandatory consent", () => {
    const input = minimalCampaign();
    // Swap "privacy" and "anagrafica": order becomes intro, cv_info, anagrafica, privacy, fine.
    input.flow.splice(3, 0, ...input.flow.splice(2, 1));

    expect(checkConsents(parsed(input)).map((i) => [i.path, i.code])).toEqual([
      ["flow[2]", "data_before_mandatory_consent"],
    ]);
  });

  it("allows message and choice steps before the mandatory consent", () => {
    // The minimal campaign already has intro and cv_info before "privacy".
    expect(checkConsents(parsed(minimalCampaign()))).toEqual([]);
  });
});
