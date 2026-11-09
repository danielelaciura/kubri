import { describe, expect, it } from "vitest";
import { checkUniqueIds } from "../../../../src/campaigns/checks/unique-ids";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkUniqueIds", () => {
  it("passes on the minimal campaign", () => {
    expect(checkUniqueIds(parsed(minimalCampaign()))).toEqual([]);
  });

  it("reports duplicate step ids", () => {
    const input = minimalCampaign();
    input.flow.push({ id: "intro", type: "message", text: { it: "Ancora ciao" } });

    expect(checkUniqueIds(parsed(input))).toEqual([
      { path: "flow[5].id", code: "duplicate_step_id", message: 'Step id "intro" is used twice' },
    ]);
  });

  it("reports duplicate question ids across blocks", () => {
    const input = minimalCampaign();
    input.flow.splice(4, 0, {
      id: "altro",
      type: "questions",
      questions: [{ id: "nome", field: "lastName", prompt: { it: "Cognome?" } }],
    });

    expect(checkUniqueIds(parsed(input)).map((i) => i.code)).toEqual(["duplicate_question_id"]);
  });

  it("reports duplicate consent keys, option ids and custom field keys", () => {
    const input = minimalCampaign();
    input.flow.splice(3, 0, {
      id: "privacy_bis",
      type: "consent",
      consentKey: "acme_privacy",
      textVersion: "1",
      text: { it: "Ancora?" },
    });
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [
        { id: "yes", description: "sì" },
        { id: "yes", description: "sì ancora" },
      ],
    };
    input.customFields = [...(input.customFields ?? []), ...(input.customFields ?? [])];

    expect(
      checkUniqueIds(parsed(input))
        .map((i) => i.code)
        .sort(),
    ).toEqual(["duplicate_consent_key", "duplicate_custom_field", "duplicate_option_id"]);
  });
});
