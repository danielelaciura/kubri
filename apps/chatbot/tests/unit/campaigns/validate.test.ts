import { describe, expect, it } from "vitest";
import { validateCampaign } from "../../../src/campaigns/validate";
import { minimalCampaign } from "./fixtures";

describe("validateCampaign", () => {
  it("returns the parsed campaign when valid", () => {
    const result = validateCampaign(minimalCampaign());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.campaign.defaultLanguage).toBe("it");
  });

  it("reports schema errors with readable paths and stops there", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "intro", type: "message", text: { en: "Hello" } };

    const result = validateCampaign(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "flow[0].text", code: "schema" }),
      );
    }
  });

  it("runs every semantic check and collects all issues", () => {
    const input = minimalCampaign();
    input.texts = {}; // unknown_text_ref
    input.flow.push({ id: "intro", type: "message", text: { it: "bis" } }); // duplicate_step_id
    input.trigger = { sender: "kubri-main", keywords: [] }; // missing_keywords

    const result = validateCampaign(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.code).sort()).toEqual(
        expect.arrayContaining(["duplicate_step_id", "missing_keywords", "unknown_text_ref"]),
      );
    }
  });

  it("includes the consent threshold checks", () => {
    const input = minimalCampaign();
    input.flow.splice(2, 1); // drop the only consent step

    const result = validateCampaign(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "flow", code: "missing_mandatory_consent" }),
      );
    }
  });

  it("rejects non-object input", () => {
    expect(validateCampaign("not a campaign").ok).toBe(false);
  });

  it("reports data collection reachable without a mandatory consent", () => {
    const input = minimalCampaign();
    // Swap "privacy" and "anagrafica": order becomes intro, cv_info, anagrafica, privacy, fine.
    input.flow.splice(3, 0, ...input.flow.splice(2, 1));

    const result = validateCampaign(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "flow[2]", code: "data_before_mandatory_consent" }),
      );
    }
  });

  it("reports an empty consent textVersion with its path", () => {
    const input = minimalCampaign();
    input.flow[2] = {
      id: "privacy",
      type: "consent",
      consentKey: "acme_privacy",
      textVersion: "  ",
      text: { it: "Accetti l'informativa sulla privacy?" },
    };

    const result = validateCampaign(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "flow[2].textVersion", code: "schema" }),
      );
    }
  });

  it("reports a missing dataController with its path", () => {
    const { dataController: _removed, ...input } = minimalCampaign();

    const result = validateCampaign(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "dataController", code: "schema" }),
      );
    }
  });
});
