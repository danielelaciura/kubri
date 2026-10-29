import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCampaign } from "../../../src/campaigns/validate";

// Every campaign the Kubri team commits must pass the same validation as the import.
const CAMPAIGNS_DIR = join(__dirname, "../../../campaigns");
const files = readdirSync(CAMPAIGNS_DIR).filter((name) => name.endsWith(".json"));

describe("committed campaign files", () => {
  it("includes the standard Kubri campaign", () => {
    expect(files).toContain("kubri-standard.json");
  });

  it.each(files)("%s is a valid campaign", (name) => {
    const input: unknown = JSON.parse(readFileSync(join(CAMPAIGNS_DIR, name), "utf8"));

    const result = validateCampaign(input);

    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it.each(files)("%s is named after its campaign slug", (name) => {
    const input = JSON.parse(readFileSync(join(CAMPAIGNS_DIR, name), "utf8")) as {
      campaign?: unknown;
    };
    expect(`${String(input.campaign)}.json`).toBe(name);
  });
});
