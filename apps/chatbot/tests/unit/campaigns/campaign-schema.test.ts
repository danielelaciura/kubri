import { describe, expect, it } from "vitest";
import { CampaignDefinitionSchema } from "../../../src/campaigns/schema/campaign";
import { minimalCampaign } from "./fixtures";

describe("CampaignDefinitionSchema", () => {
  it("accepts the minimal campaign and applies defaults", () => {
    const parsed = CampaignDefinitionSchema.parse(minimalCampaign());

    expect(parsed.defaultLanguage).toBe("it");
    expect(parsed.onStop).toEqual({ data: "delete" });
    expect(parsed.trigger.isDefault).toBe(false);
    expect(parsed.afterCompletion).toEqual({ allowEdits: true, allowCvRegeneration: false });
  });

  it("applies step and question defaults", () => {
    const parsed = CampaignDefinitionSchema.parse(minimalCampaign());
    const consent = parsed.flow.find((s) => s.type === "consent");
    const questions = parsed.flow.find((s) => s.type === "questions");

    expect(consent?.type === "consent" && consent.optional).toBe(false);
    expect(questions?.type === "questions" && questions.questions[0]).toMatchObject({
      required: true,
      maxClarifications: 2,
    });
  });

  it("lowercases and trims trigger keywords", () => {
    const input = minimalCampaign();
    input.trigger.keywords = ["  ACME "];
    expect(CampaignDefinitionSchema.parse(input).trigger.keywords).toEqual(["acme"]);
  });

  it("accepts text references", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "intro", type: "message", text: { ref: "cv_explain" } };
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(true);
  });

  it("rejects unknown step types", () => {
    const input = minimalCampaign() as { flow: unknown[] };
    input.flow.push({ id: "x", type: "appointment" });
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unknown properties (typos must not pass silently)", () => {
    const input = { ...minimalCampaign(), extrnalKey: "typo" };
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects choices with fewer than two options", () => {
    const input = minimalCampaign();
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [{ id: "yes", description: "sì" }],
    };
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects invalid ids", () => {
    const input = minimalCampaign();
    input.flow[0] = { id: "Intro-1", type: "message", text: { it: "Ciao" } };
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it("rejects maxClarifications above 5", () => {
    const input = minimalCampaign();
    input.flow[3] = {
      id: "anagrafica",
      type: "questions",
      questions: [{ id: "nome", field: "firstName", prompt: { it: "?" }, maxClarifications: 9 }],
    };
    expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
  });

  it.each(["javascript:alert(1)", "http://example.com/privacy", "ftp://example.com/privacy"])(
    "rejects a non-https privacy url (%s)",
    (url) => {
      const input = minimalCampaign();
      input.dataController.privacyUrl = url;
      expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
    },
  );

  it.each(["javascript:alert(1)", "http://example.com/privacy", "ftp://example.com/privacy"])(
    "rejects a non-https consent link (%s)",
    (url) => {
      const input = minimalCampaign();
      const consent = input.flow[2];
      if (consent?.type !== "consent") throw new Error("fixture changed");
      consent.link = url;
      expect(CampaignDefinitionSchema.safeParse(input).success).toBe(false);
    },
  );
});
