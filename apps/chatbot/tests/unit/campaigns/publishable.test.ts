import { describe, expect, it } from "vitest";
import { checkPublishable, placeholderConsentIssues } from "../../../src/campaigns/publishable";
import { minimalCampaign, parsed } from "./fixtures";

function withPlaceholderConsent() {
  const input = minimalCampaign();
  const consent = input.flow[2];
  if (consent?.type !== "consent") throw new Error("fixture: flow[2] must be the consent");
  consent.textVersion = "placeholder-2026-10";
  return parsed(input);
}

describe("placeholderConsentIssues", () => {
  it("accepts official text versions", () => {
    expect(placeholderConsentIssues(parsed(minimalCampaign()))).toEqual([]);
  });

  it("flags placeholder- text versions with their path", () => {
    expect(placeholderConsentIssues(withPlaceholderConsent())).toEqual([
      expect.objectContaining({ path: "flow[2].textVersion", code: "placeholder_consent" }),
    ]);
  });
});

describe("checkPublishable", () => {
  it("blocks placeholder consents in production", () => {
    const result = checkPublishable(withPlaceholderConsent(), "production");

    expect(result.errors.map((i) => i.code)).toEqual(["placeholder_consent"]);
    expect(result.warnings).toEqual([]);
  });

  it.each(["development", "test"] as const)("only warns in %s", (nodeEnv) => {
    const result = checkPublishable(withPlaceholderConsent(), nodeEnv);

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((i) => i.code)).toEqual(["placeholder_consent"]);
  });

  it("returns nothing for a campaign with official texts", () => {
    expect(checkPublishable(parsed(minimalCampaign()), "production")).toEqual({
      errors: [],
      warnings: [],
    });
  });
});
