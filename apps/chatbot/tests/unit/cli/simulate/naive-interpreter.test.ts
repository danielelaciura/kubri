import { describe, expect, it } from "vitest";
import { coerceValue } from "../../../../src/cli/simulate/interpretations";
import { naiveInterpret } from "../../../../src/cli/simulate/naive-interpreter";
import type { SessionState } from "../../../../src/engine/state";
import { getStandardField } from "../../../../src/profile/standard-fields";
import { atQuestion, campaign, flowState } from "../../engine/helpers";
import { initialSessionState } from "../../../../src/engine/state";

const c = campaign();
const interpret = (text: string, state: SessionState) =>
  naiveInterpret({ text, state, campaign: c, history: [], turnId: null });

function field(key: string) {
  const def = getStandardField(key);
  if (!def) throw new Error(key);
  return def;
}

describe("naiveInterpret", () => {
  it("leaves the language phase to the engine (names, then the default)", () => {
    expect(interpret("english", initialSessionState())).toEqual({
      language: { code: "it", confidence: 0.5 },
      intent: "unclear",
      patch: [],
      currentQuestion: { completeness: "absent" },
    });
  });

  it.each([
    ["idk", "idk"],
    ["3", "idk"],
    ["sì", "yes"],
    ["No", "no"],
  ])("picks the option %j of a choice step", (text, option) => {
    const result = interpret(text, flowState({ stepId: "cv_info" }));
    expect(result).toMatchObject({ intent: "choice", choice: option });
  });

  it.each([
    ["sì", "accepted"],
    ["ok", "accepted"],
    ["no", "declined"],
  ])("answers a consent with %j", (text, outcome) => {
    expect(interpret(text, flowState({ stepId: "privacy" }))).toMatchObject({
      intent: "choice",
      choice: outcome,
    });
  });

  it("does not understand anything else on a consent", () => {
    expect(interpret("forse", flowState({ stepId: "privacy" })).intent).toBe("unclear");
  });

  it("answers the current question with the text", () => {
    expect(interpret("Mario", atQuestion("nome"))).toEqual({
      language: { code: "it", confidence: 0.5 },
      intent: "answer",
      patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
      currentQuestion: { completeness: "complete" },
    });
  });

  it("turns yes/no into a boolean for a bool question", () => {
    expect(interpret("no", atQuestion("patente")).patch).toEqual([
      { field: "drivingLicense", value: false, confidence: 0.95, evidence: "no" },
    ]);
  });

  it("answers a pending confirmation with yes/no, not with a value", () => {
    const state = atQuestion("nome", {
      pendingConfirmation: { kind: "value", field: "firstName", value: "Mrio", confidence: 0.5 },
    });

    expect(interpret("sì", state)).toMatchObject({ intent: "choice", choice: "yes", patch: [] });
  });

  it("does not understand a value of the wrong type", () => {
    expect(interpret("boh", atQuestion("patente")).intent).toBe("unclear");
  });
});

describe("coerceValue", () => {
  it.each([
    ["number", { key: "x", type: "number", description: "" }, "3,5", 3.5],
    ["date (it)", field("birthday"), "5/3/1990", "1990-03-05"],
    ["date (iso)", field("birthday"), "1990-03-05", "1990-03-05"],
    ["enum", field("italianLevel"), "Intermedio", "intermedio"],
    ["list", field("drivingLicenseTypes"), "B, C; CQC", ["B", "C", "CQC"]],
    ["iso-country", field("country"), "ma", "MA"],
    ["iso-language", field("language"), "AR", "ar"],
    ["text", field("location"), "  Bologna ", "Bologna"],
  ] as const)("converts a %s", (_name, def, text, expected) => {
    expect(coerceValue(text, def)).toEqual(expected);
  });

  it.each([
    [field("drivingLicense"), "boh"],
    [{ key: "x", type: "number", description: "" } as const, "tre"],
    [field("birthday"), "ieri"],
    [field("italianLevel"), "ottimo"],
    [field("location"), "   "],
  ])("refuses %j", (def, text) => {
    expect(coerceValue(text, def)).toBeUndefined();
  });
});
