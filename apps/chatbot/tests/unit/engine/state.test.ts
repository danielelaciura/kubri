import { describe, expect, it } from "vitest";
import { conditionContext, initialSessionState } from "../../../src/engine/state";

describe("initialSessionState", () => {
  it("starts in the language phase with nothing collected", () => {
    expect(initialSessionState()).toEqual({
      phase: "language",
      stepId: null,
      questionId: null,
      clarifications: 0,
      pendingConfirmation: null,
      outcomes: {},
      language: null,
      consentsAccepted: false,
      profile: {},
    });
  });
});

describe("conditionContext", () => {
  it("exposes profile values and step outcomes, without unresolved fields", () => {
    const state = {
      ...initialSessionState(),
      outcomes: { cv_info: "yes" },
      profile: {
        drivingLicense: { value: true, confidence: 1, status: "confirmed" as const },
        workingPermit: { value: null, confidence: 0, status: "unresolved" as const },
      },
    };
    expect(conditionContext(state)).toEqual({
      values: { drivingLicense: true },
      outcomes: { cv_info: "yes" },
    });
  });
});
