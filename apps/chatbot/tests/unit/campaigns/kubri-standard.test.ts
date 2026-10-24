import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { placeholderConsentIssues } from "../../../src/campaigns/publishable";
import { validateCampaign } from "../../../src/campaigns/validate";
import type { CampaignDefinition } from "../../../src/campaigns/schema/campaign";
import { STANDARD_FIELD_DEFINITIONS } from "../../../src/profile/standard-fields";

function loadStandard(): CampaignDefinition {
  const raw: unknown = JSON.parse(
    readFileSync(join(__dirname, "../../../campaigns/kubri-standard.json"), "utf8"),
  );
  const result = validateCampaign(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.campaign;
}

describe("kubri-standard campaign", () => {
  const campaign = loadStandard();

  it("is the default campaign of the Kubri number, on the global pool", () => {
    expect(campaign.organization).toBe("kubri");
    expect(campaign.externalKey).toBe("global");
    expect(campaign.trigger).toMatchObject({ sender: "kubri-main", isDefault: true });
  });

  it("asks the Appendix A consents with placeholder versions", () => {
    const consents = campaign.flow.flatMap((step) =>
      step.type === "consent"
        ? [{ key: step.consentKey, optional: step.optional, version: step.textVersion }]
        : [],
    );
    expect(consents).toEqual([
      { key: "privacy_interview", optional: false, version: "placeholder-2026-10" },
      { key: "kubri_global", optional: true, version: "placeholder-2026-10" },
    ]);
    expect(placeholderConsentIssues(campaign)).toHaveLength(2);
  });

  it("asks every standard field that is not system-only", () => {
    const asked = campaign.flow.flatMap((step) =>
      step.type === "questions" ? step.questions.map((q) => q.field) : [],
    );
    const askable = STANDARD_FIELD_DEFINITIONS.filter((f) => f.systemOnly !== true).map(
      (f) => f.key,
    );
    expect([...asked].sort()).toEqual([...askable].sort());
  });

  it("gives every question an extraction hint", () => {
    const withoutHint = campaign.flow.flatMap((step) =>
      step.type === "questions" ? step.questions.filter((q) => !q.hint).map((q) => q.id) : [],
    );
    expect(withoutHint).toEqual([]);
  });

  it("offers the CV and ends", () => {
    expect(campaign.flow.map((step) => step.type).slice(-2)).toEqual(["cv_offer", "end"]);
  });
});
