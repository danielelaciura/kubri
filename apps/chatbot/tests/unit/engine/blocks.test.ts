import { describe, expect, it } from "vitest";
import { nextAskableQuestion } from "../../../src/engine/blocks";
import { campaign, flowState, inferred, questionOf, questionsStep } from "./helpers";

const block = questionsStep(campaign(), "anagrafica"); // nome, patente, notte (if patente)

describe("nextAskableQuestion", () => {
  it("asks the first open question", () => {
    expect(nextAskableQuestion(block, 0, flowState())).toEqual({
      kind: "ask",
      question: questionOf(block, "nome"),
    });
  });

  it("skips questions whose field is already filled (early answers)", () => {
    const state = flowState({ profile: { firstName: inferred("Mario") } });
    expect(nextAskableQuestion(block, 0, state)).toEqual({
      kind: "ask",
      question: questionOf(block, "patente"),
    });
  });

  it("skips unresolved fields", () => {
    const state = flowState({
      profile: { firstName: { value: null, confidence: 0, status: "unresolved" } },
    });
    expect(nextAskableQuestion(block, 0, state)).toMatchObject({ question: { id: "patente" } });
  });

  it("asks again a field below the confidence threshold", () => {
    const state = flowState({
      profile: { firstName: { value: "Mrio", confidence: 0.5, status: "inferred" } },
    });
    expect(nextAskableQuestion(block, 0, state)).toMatchObject({ question: { id: "nome" } });
  });

  it("skips a question whose when is false", () => {
    const state = flowState({
      profile: { firstName: inferred("Mario"), drivingLicense: inferred(false) },
    });
    expect(nextAskableQuestion(block, 0, state)).toEqual({ kind: "completed" });
  });

  it("asks a conditional question when its when holds", () => {
    const state = flowState({
      profile: { firstName: inferred("Mario"), drivingLicense: inferred(true) },
    });
    expect(nextAskableQuestion(block, 0, state)).toMatchObject({ question: { id: "notte" } });
  });

  it("starts from the given index", () => {
    expect(nextAskableQuestion(block, 1, flowState())).toMatchObject({
      question: { id: "patente" },
    });
  });

  describe("terminateIf", () => {
    const withTerminate = questionsStep(
      campaign((input) => {
        input.flow[3] = {
          id: "anagrafica",
          type: "questions",
          questions: [
            {
              id: "patente",
              field: "drivingLicense",
              prompt: { it: "Hai la patente?" },
              terminateIf: { field: "drivingLicense", eq: false },
            },
            {
              id: "permesso",
              field: "workingPermit",
              prompt: { it: "Hai il permesso di lavoro?" },
              when: { field: "drivingLicense", eq: true },
              terminateIf: { field: "workingPermit", eq: false },
            },
          ],
        };
      }),
      "anagrafica",
    );

    it("terminates when a filled question's terminateIf holds", () => {
      const state = flowState({ profile: { drivingLicense: inferred(false) } });
      expect(nextAskableQuestion(withTerminate, 0, state)).toEqual({ kind: "terminated" });
    });

    it("does not evaluate terminateIf of a question skipped by its when", () => {
      const state = flowState({
        profile: { drivingLicense: inferred(true), workingPermit: inferred(true) },
      });
      expect(nextAskableQuestion(withTerminate, 0, state)).toEqual({ kind: "completed" });
      const skipped = flowState({
        profile: { drivingLicense: inferred(false), workingPermit: inferred(false) },
      });
      expect(nextAskableQuestion(withTerminate, 1, skipped)).toEqual({ kind: "completed" });
    });
  });
});
