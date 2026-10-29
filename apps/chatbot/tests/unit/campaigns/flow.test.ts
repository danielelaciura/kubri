import { describe, expect, it } from "vitest";
import type { ConditionContext } from "../../../src/campaigns/conditions/evaluate";
import { nextEligibleStep, resolveTransition, stepOutcomes } from "../../../src/campaigns/flow";
import { CampaignDefinitionSchema } from "../../../src/campaigns/schema/campaign";
import type { Step } from "../../../src/campaigns/schema/steps";
import { minimalCampaign } from "./fixtures";

const flow = CampaignDefinitionSchema.parse(minimalCampaign()).flow;
const step = (id: string): Step => {
  const found = flow.find((s) => s.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
};

describe("stepOutcomes", () => {
  it.each([
    ["intro", ["next"]],
    ["cv_info", ["yes", "no", "idk"]],
    ["privacy", ["accepted", "declined"]],
    ["anagrafica", ["completed", "terminated"]],
    ["fine", []],
  ])("%s → %j", (id, outcomes) => {
    expect(stepOutcomes(step(id))).toEqual(outcomes);
  });
});

describe("resolveTransition", () => {
  it("defaults to the next step", () => {
    expect(resolveTransition(step("cv_info"), "yes", "privacy")).toEqual({ target: "privacy" });
  });

  it("defaults to @end after the last step", () => {
    expect(resolveTransition(step("intro"), "next", undefined)).toEqual({ target: "@end" });
  });

  it("uses an explicit target", () => {
    expect(resolveTransition(step("cv_info"), "no", "privacy")).toEqual({ target: "@stop" });
  });

  it("returns the reply of a reply-then transition", () => {
    expect(resolveTransition(step("cv_info"), "idk", "privacy")).toEqual({
      reply: "cv_explain",
      target: "@repeat",
    });
  });

  it("stops on a declined mandatory consent", () => {
    expect(resolveTransition(step("privacy"), "declined", "anagrafica")).toEqual({
      target: "@stop",
    });
  });

  it("continues on a declined optional consent", () => {
    const optional = { ...step("privacy"), optional: true } as Step;
    expect(resolveTransition(optional, "declined", "anagrafica")).toEqual({
      target: "anagrafica",
    });
  });

  it("stops when a questions block terminates", () => {
    expect(resolveTransition(step("anagrafica"), "terminated", "fine")).toEqual({
      target: "@stop",
    });
  });

  it("does not resolve outcome ids against Object.prototype", () => {
    const input = minimalCampaign();
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [
        { id: "constructor", description: "uno" },
        { id: "no", description: "due" },
      ],
      on: { no: "@stop" },
    };
    const choice = CampaignDefinitionSchema.parse(input).flow[1] as Step;

    expect(resolveTransition(choice, "constructor", "privacy")).toEqual({ target: "privacy" });
  });
});

describe("nextEligibleStep", () => {
  const input = minimalCampaign();
  input.flow.splice(1, 0, {
    id: "license_note",
    type: "message",
    when: { field: "drivingLicense", eq: true },
    text: { it: "Bene, la patente è utile." },
  });
  const conditional = CampaignDefinitionSchema.parse(input).flow;
  const ctx = (values: Record<string, unknown> = {}): ConditionContext => ({
    values,
    outcomes: {},
  });

  it("returns the step itself when it has no condition", () => {
    expect(nextEligibleStep(conditional, 0, ctx())).toBe(0);
  });

  it("skips a step whose when is false", () => {
    expect(nextEligibleStep(conditional, 1, ctx())).toBe(2);
  });

  it("keeps a step whose when is true", () => {
    expect(nextEligibleStep(conditional, 1, ctx({ drivingLicense: true }))).toBe(1);
  });

  it("returns undefined past the end of the flow", () => {
    expect(nextEligibleStep(conditional, conditional.length, ctx())).toBeUndefined();
  });

  it("returns undefined when every remaining step is skipped", () => {
    expect(nextEligibleStep(conditional.slice(1, 2), 0, ctx())).toBeUndefined();
  });
});
