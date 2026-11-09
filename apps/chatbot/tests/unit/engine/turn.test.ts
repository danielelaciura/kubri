import { describe, expect, it } from "vitest";
import { initialSessionState } from "../../../src/engine/state";
import {
  EngineError,
  MAX_AUTO_ADVANCES,
  createTurn,
  currentStep,
  emit,
  incoherent,
  say,
  setState,
  stepAt,
  systemText,
} from "../../../src/engine/turn";
import { AT, campaign, flowState, thrown } from "./helpers";

describe("turn", () => {
  it("allows 20 automatic advances per turn (spec §7.2 point 9)", () => {
    expect(MAX_AUTO_ADVANCES).toBe(20);
  });

  it("collects effects and replaces the state without mutating the original", () => {
    const state = initialSessionState();
    const turn = createTurn(state, campaign(), AT);

    setState(turn, { phase: "flow" });
    say(turn, systemText("system.welcome"));
    say(turn, systemText("system.not_understood"), "rephrase");
    emit(turn, { type: "OptOut", at: AT });

    expect(state.phase).toBe("language");
    expect(turn.state.phase).toBe("flow");
    expect(turn.effects).toEqual([
      { type: "SendText", text: { kind: "system", key: "system.welcome" } },
      {
        type: "SendText",
        text: { kind: "system", key: "system.not_understood" },
        purpose: "rephrase",
      },
      { type: "OptOut", at: AT },
    ]);
  });

  it("adds params to a system text only when given", () => {
    expect(systemText("system.progress", { current: 1, total: 2 })).toEqual({
      kind: "system",
      key: "system.progress",
      params: { current: 1, total: 2 },
    });
    expect(systemText("system.help")).not.toHaveProperty("params");
  });

  it("finds the current step and its index", () => {
    const turn = createTurn(flowState({ stepId: "privacy" }), campaign(), AT);
    const { step, index } = currentStep(turn);
    expect([step.id, index]).toEqual(["privacy", 2]);
  });

  it.each([null, "ghost"])("treats current step %j as an incoherent state", (stepId) => {
    const turn = createTurn(flowState({ stepId }), campaign(), AT);
    expect(thrown(() => currentStep(turn))).toMatchObject({
      name: "EngineError",
      reason: "incoherent_state",
    });
  });

  it("throws on a missing step index", () => {
    const turn = createTurn(flowState(), campaign(), AT);
    expect(thrown(() => stepAt(turn, 99))).toBeInstanceOf(EngineError);
  });

  it("incoherent() throws an EngineError", () => {
    expect(thrown(() => incoherent("boom"))).toMatchObject({
      reason: "incoherent_state",
      message: "boom",
    });
  });
});
