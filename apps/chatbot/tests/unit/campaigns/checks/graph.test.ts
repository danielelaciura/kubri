import { describe, expect, it } from "vitest";
import { checkGraph } from "../../../../src/campaigns/checks/graph";
import { minimalCampaign, parsed } from "../fixtures";

describe("checkGraph", () => {
  it("passes on the minimal campaign (@repeat is allowed)", () => {
    expect(checkGraph(parsed(minimalCampaign()))).toEqual([]);
  });

  it("reports unreachable steps", () => {
    const input = minimalCampaign();
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [
        { id: "yes", description: "sì" },
        { id: "no", description: "no" },
      ],
      on: { yes: "anagrafica", no: "@stop" },
    };

    expect(checkGraph(parsed(input))).toEqual([
      {
        path: "flow[2]",
        code: "unreachable_step",
        message: 'Step "privacy" can never be reached',
      },
    ]);
  });

  it("keeps the next step reachable when a step can be skipped by `when`", () => {
    const input = minimalCampaign();
    input.flow[1] = {
      id: "cv_info",
      type: "choice",
      prompt: { it: "?" },
      options: [
        { id: "yes", description: "sì" },
        { id: "no", description: "no" },
      ],
      when: { field: "drivingLicense", eq: true },
      on: { yes: "anagrafica", no: "@stop" },
    };

    expect(checkGraph(parsed(input))).toEqual([]);
  });

  it("reports cycles", () => {
    const input = minimalCampaign();
    input.flow[3] = {
      id: "anagrafica",
      type: "questions",
      questions: [{ id: "nome", field: "firstName", prompt: { it: "?" } }],
      on: { completed: "intro" },
    };

    // "fine" also becomes unreachable: completed now loops back, terminated goes to @stop.
    expect(checkGraph(parsed(input))).toEqual([
      {
        path: "flow[4]",
        code: "unreachable_step",
        message: 'Step "fine" can never be reached',
      },
      {
        path: "flow[3].on",
        code: "cycle",
        message: 'Step "anagrafica" leads back to "intro": cycles are not allowed (use @repeat)',
      },
    ]);
  });
});
