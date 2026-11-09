import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { placeholderConsentIssues } from "../../../src/campaigns/publishable";
import { validateCampaign } from "../../../src/campaigns/validate";
import type { CampaignDefinition } from "../../../src/campaigns/schema/campaign";
import type { Question } from "../../../src/campaigns/schema/steps";
import { ITALIAN_LEVELS, STANDARD_FIELD_DEFINITIONS } from "../../../src/profile/standard-fields";

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
    expect(placeholderConsentIssues(campaign)).toHaveLength(4);
  });

  it("asks the three blocks of the Make questionnaire, in Make's order", () => {
    const blocks = campaign.flow.flatMap((step) =>
      step.type === "questions" ? [[step.id, step.questions.map((q) => q.field)] as const] : [],
    );
    expect(blocks).toEqual([
      ["professionale", ["workExperience", "skillsAndCompetences", "educationAndTraining"]],
      ["personale", ["firstName", "lastName", "birthday", "address", "location", "drivingLicense"]],
      [
        "trasversale",
        [
          "language",
          "jobPreferences.preferredJob",
          "learningPreferences.isInterested",
          "learningPreferences.preference",
        ],
      ],
    ]);
  });

  it("only asks standard fields that are not system-only", () => {
    const asked = campaign.flow.flatMap((step) =>
      step.type === "questions" ? step.questions.map((q) => q.field) : [],
    );
    const askable = new Set(
      STANDARD_FIELD_DEFINITIONS.filter((f) => f.systemOnly !== true).map((f) => f.key),
    );
    expect(asked.filter((field) => !askable.has(field))).toEqual([]);
  });

  it("gives every question an extraction hint", () => {
    const withoutHint = campaign.flow.flatMap((step) =>
      step.type === "questions" ? step.questions.filter((q) => !q.hint).map((q) => q.id) : [],
    );
    expect(withoutHint).toEqual([]);
  });

  const questionFor = (field: string): Question => {
    const found = campaign.flow
      .flatMap((step) => (step.type === "questions" ? step.questions : []))
      .find((q) => q.field === field);
    if (!found) throw new Error(`no question for ${field}`);
    return found;
  };

  it("asks name, surname and birth date together, with fallbacks for what is missing", () => {
    const prompt = questionFor("firstName").prompt;
    if ("ref" in prompt) throw new Error("expected an inline prompt");
    expect(prompt["it"]).toMatch(/nome e cognome/);
    expect(prompt["it"]).toMatch(/data di nascita/);
    expect(questionFor("firstName").hint).toMatch(/lastName/);
    expect(questionFor("firstName").hint).toMatch(/birthday/);
    expect(questionFor("address").hint).toMatch(/location/);
  });

  it("extracts the Italian level, with the enum's values, from the languages question", () => {
    const hint = questionFor("language").hint ?? "";

    expect(hint).toMatch(/italianLevel/);
    expect(hint).toMatch(/additionalLanguages/);
    for (const level of ITALIAN_LEVELS) expect(hint).toContain(level);
  });

  it("asks which course only to who is interested, as an optional question", () => {
    const question = questionFor("learningPreferences.preference");

    expect(question.required).toBe(false);
    expect(question.when).toEqual({ field: "learningPreferences.isInterested", eq: true });
  });

  it("offers the CV and ends", () => {
    expect(campaign.flow.map((step) => step.type).slice(-2)).toEqual(["cv_offer", "end"]);
  });
});
