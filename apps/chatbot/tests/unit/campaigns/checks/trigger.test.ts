import { describe, expect, it } from "vitest";
import { checkTrigger } from "../../../../src/campaigns/checks/trigger";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkTrigger", () => {
  it("passes on the minimal campaign", () => {
    expect(checkTrigger(parsed(minimalCampaign()))).toEqual([]);
  });

  it("requires keywords on non-default campaigns", () => {
    const input = minimalCampaign();
    input.trigger = { sender: "kubri-main", keywords: [] };

    expect(checkTrigger(parsed(input))).toEqual([
      {
        path: "trigger.keywords",
        code: "missing_keywords",
        message: "A campaign that is not the sender default needs at least one keyword",
      },
    ]);
  });

  it("allows a default campaign without keywords", () => {
    const input = minimalCampaign();
    input.trigger = { sender: "kubri-main", keywords: [], isDefault: true };
    expect(checkTrigger(parsed(input))).toEqual([]);
  });

  it("reports duplicate keywords after normalization", () => {
    const input = minimalCampaign();
    input.trigger = { sender: "kubri-main", keywords: ["acme", " ACME "] };

    expect(checkTrigger(parsed(input)).map((i) => [i.path, i.code])).toEqual([
      ["trigger.keywords[1]", "duplicate_keyword"],
    ]);
  });
});
