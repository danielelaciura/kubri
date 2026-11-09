import { describe, expect, it } from "vitest";
import type { ConditionContext } from "../../../src/campaigns/conditions/evaluate";
import { sectionProgress } from "../../../src/engine/progress";
import { campaign } from "./helpers";

const ctx = (values: Record<string, unknown> = {}): ConditionContext => ({ values, outcomes: {} });

describe("sectionProgress", () => {
  it("counts the only block of the minimal campaign", () => {
    expect(sectionProgress(campaign().flow, 3, ctx())).toEqual({ current: 1, total: 1 });
  });

  describe("with several blocks", () => {
    // intro, cv_info, privacy, anagrafica, lavoro, guida (if drivingLicense), fine
    const flow = campaign((input) => {
      input.flow.splice(
        4,
        0,
        {
          id: "lavoro",
          type: "questions",
          questions: [
            {
              id: "desiderato",
              field: "jobPreferences.preferredJob",
              prompt: { it: "Che lavoro cerchi?" },
            },
          ],
        },
        {
          id: "guida",
          type: "questions",
          when: { field: "drivingLicense", eq: true },
          questions: [
            { id: "tipi", field: "drivingLicenseTypes", prompt: { it: "Quali patenti hai?" } },
          ],
        },
      );
    }).flow;

    it("numbers the current block and leaves out blocks excluded by their condition", () => {
      expect(sectionProgress(flow, 4, ctx())).toEqual({ current: 2, total: 2 });
    });

    it("includes conditional blocks when the condition holds", () => {
      expect(sectionProgress(flow, 5, ctx({ drivingLicense: true }))).toEqual({
        current: 3,
        total: 3,
      });
    });

    it("counts only the blocks already behind a non-questions step", () => {
      expect(sectionProgress(flow, 2, ctx())).toEqual({ current: 0, total: 2 });
    });
  });
});
