import { describe, expect, it } from "vitest";
import { findTriggerCollisions, type CampaignTrigger } from "../../../src/campaigns/triggers";
import { minimalCampaign, parsed } from "./fixtures";

// minimalCampaign(): slug "acme-magazzino", sender "kubri-main", keywords ["acme"].
const campaign = parsed(minimalCampaign());

function defaultCampaign() {
  const input = minimalCampaign();
  input.trigger = { sender: "kubri-main", keywords: [], isDefault: true };
  return parsed(input);
}

describe("findTriggerCollisions", () => {
  it("accepts disjoint keywords", () => {
    const others: CampaignTrigger[] = [
      { slug: "culligan-vendita", keywords: ["culligan"], isDefault: false },
    ];
    expect(findTriggerCollisions(campaign, others)).toEqual([]);
  });

  it("reports a keyword used by another active campaign", () => {
    const others: CampaignTrigger[] = [
      { slug: "acme-pulizie", keywords: ["pulizie", "acme"], isDefault: false },
    ];

    expect(findTriggerCollisions(campaign, others)).toEqual([
      expect.objectContaining({
        path: "trigger.keywords[0]",
        code: "keyword_collision",
        message: expect.stringContaining("acme-pulizie") as unknown,
      }),
    ]);
  });

  it("ignores the campaign's own previous version (same slug)", () => {
    const others: CampaignTrigger[] = [
      { slug: "acme-magazzino", keywords: ["acme"], isDefault: false },
    ];
    expect(findTriggerCollisions(campaign, others)).toEqual([]);
  });

  it("reports a second default campaign on the same sender", () => {
    const others: CampaignTrigger[] = [{ slug: "kubri-standard", keywords: [], isDefault: true }];

    expect(findTriggerCollisions(defaultCampaign(), others)).toEqual([
      expect.objectContaining({ path: "trigger.isDefault", code: "duplicate_default_campaign" }),
    ]);
  });

  it("allows a non-default campaign next to the default one", () => {
    const others: CampaignTrigger[] = [{ slug: "kubri-standard", keywords: [], isDefault: true }];
    expect(findTriggerCollisions(campaign, others)).toEqual([]);
  });
});
