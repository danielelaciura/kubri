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

    expect(checkConsents(parsed(input))).toEqual([
      {
        path: "flow[4].optional",
        code: "kubri_global_not_optional",
        message: "The kubri_global consent must be optional (spec §7.3)",
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

    expect(checkConsents(parsed(input))).toEqual([
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
});
