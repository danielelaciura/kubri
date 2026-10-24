import { describe, expect, it } from "vitest";
import { resolveTransition, stepOutcomes } from "../../../src/campaigns/flow";
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
});
