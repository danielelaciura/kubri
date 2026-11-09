import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../../src/engine/interpretation";
import { step } from "../../../src/engine/step";
import { campaign, choice, flowState, interpretation, others, sent, userTurn } from "./helpers";

describe("choice answers", () => {
  const c = campaign();
  const atChoice = flowState({ stepId: "cv_info", outcomes: { intro: "next" } });

  it("follows the chosen option to the next step", () => {
    const result = step(atChoice, userTurn("sì", choice("yes")), c);

    expect(sent(result.effects)).toEqual(["privacy"]);
    expect(result.state.outcomes).toEqual({ intro: "next", cv_info: "yes" });
  });

  it("sends the transition reply and repeats the step", () => {
    const result = step(atChoice, userTurn("cos'è?", choice("idk")), c);

    expect(sent(result.effects)).toEqual(["texts.cv_explain", "cv_info"]);
  });

  it("stops on an option leading to @stop (before the threshold: delete)", () => {
    const result = step(atChoice, userTurn("no", choice("no")), c);

    expect(sent(result.effects)).toEqual(["system.stopped"]);
    expect(others(result.effects)).toEqual(["StopSession:flow_stop:delete"]);
    expect(result.state.phase).toBe("closed");
  });

  it.each([
    ["an unknown option", choice("maybe")],
    ["a non-choice intent", interpretation()],
  ] as [string, Interpretation][])("asks again on %s", (_label, interp) => {
    const result = step(atChoice, userTurn("mah", interp), c);

    expect(sent(result.effects)).toEqual(["system.not_understood", "cv_info"]);
    expect(result.state.stepId).toBe("cv_info");
  });
});

describe("cv_offer answers", () => {
  const c = campaign((input) => {
    input.flow.splice(4, 0, {
      id: "cv",
      type: "cv_offer",
      prompt: { it: "Vuoi che prepari il tuo CV?" },
    });
  });
  const atCv = flowState({ stepId: "cv", consentsAccepted: true });

  it("enqueues the CV on yes, then moves on", () => {
    const result = step(atCv, userTurn("sì", choice("yes")), c);

    expect(sent(result.effects)).toEqual(["fine"]);
    expect(others(result.effects)).toEqual([
      "EnqueueJob:cv",
      "CompleteSession",
      "EnqueueJob:kubri-webhook:interview.completed",
    ]);
  });

  it("moves on without a CV on no", () => {
    const result = step(atCv, userTurn("no", choice("no")), c);

    expect(others(result.effects)).toEqual([
      "CompleteSession",
      "EnqueueJob:kubri-webhook:interview.completed",
    ]);
  });

  it("asks again on anything else", () => {
    const result = step(atCv, userTurn("forse", choice("maybe")), c);

    expect(sent(result.effects)).toEqual(["system.not_understood", "cv"]);
  });
});
