import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { validateCampaign } from "../../src/campaigns/validate";
import { runScenario } from "./harness/run";
import { ScenarioSchema } from "./harness/scenario";

const APP_ROOT = join(__dirname, "../..");
const SCENARIO_FILES = readdirSync(__dirname, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".yaml"))
  .sort();
const CAMPAIGN_FILES = readdirSync(join(__dirname, "campaigns")).filter((f) => f.endsWith(".json"));

function loadCampaign(path: string) {
  const result = validateCampaign(JSON.parse(readFileSync(join(APP_ROOT, path), "utf8")));
  if (!result.ok) throw new Error(`${path} is invalid: ${JSON.stringify(result.issues)}`);
  return result.campaign;
}

describe.each(CAMPAIGN_FILES)("scenario campaign %s", (file) => {
  it("passes validateCampaign", () => {
    expect(() => loadCampaign(join("tests/scenarios/campaigns", file))).not.toThrow();
  });
});

describe.each(SCENARIO_FILES)("scenario %s", (file) => {
  it("plays as expected", () => {
    const scenario = ScenarioSchema.parse(parse(readFileSync(join(__dirname, file), "utf8")));
    const campaign = loadCampaign(scenario.campaign);
    for (const report of runScenario(scenario, campaign)) {
      const where = `${scenario.description} — ${report.label}`;
      expect(report.silent, `${where}: the bot stayed silent`).toBe(false);
      expect(report.actual, where).toEqual(report.expected);
    }
  });
});
