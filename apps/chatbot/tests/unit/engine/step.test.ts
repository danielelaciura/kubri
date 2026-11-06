import { describe, expect, it } from "vitest";
import type { EngineEvent } from "../../../src/engine/events";
import { initialSessionState } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import { AT, campaign, flowState, interpretation, others, sent, userTurn } from "./helpers";

const c = campaign();

describe("step: session start and language phase", () => {
  it("welcomes the candidate on session_started", () => {
    const state = initialSessionState();
    const result = step(state, { type: "session_started", at: AT }, c);

    expect(sent(result.effects)).toEqual(["system.welcome"]);
    expect(result.state).toEqual(state);
  });

  it("sets the language from a language name and enters the flow", () => {
    const result = step(initialSessionState(), userTurn("Arabo"), c);

    expect(others(result.effects)).toEqual(["SetLanguage:ar"]);
    expect(sent(result.effects)).toEqual(["intro", "cv_info"]);
    expect(result.state).toMatchObject({ phase: "flow", language: "ar", stepId: "cv_info" });
  });

  it("uses the detected language when confident", () => {
    const interp = interpretation({ language: { code: "ar", confidence: 0.95 } });
    const result = step(initialSessionState(), userTurn("مرحبا", interp), c);

    expect(others(result.effects)).toEqual(["SetLanguage:ar"]);
  });

  it("falls back to the campaign default language", () => {
    const interp = interpretation({ language: { code: "en", confidence: 0.5 } });
    const result = step(initialSessionState(), userTurn("ok", interp), c);

    expect(others(result.effects)).toEqual(["SetLanguage:it"]);
  });
});

describe("step: other events and phases", () => {
  it("answers in a closed session without changing it", () => {
    const state = flowState({ phase: "closed", stepId: null });
    const result = step(state, userTurn("ciao"), c);

    expect(sent(result.effects)).toEqual(["system.session_closed"]);
    expect(result.state).toEqual(state);
  });

  it("does nothing on timeout (follow-up is out of v1 scope)", () => {
    const state = flowState({ stepId: "cv_info" });
    expect(step(state, { type: "timeout", at: AT }, c)).toEqual({ state, effects: [] });
  });

  it("flags the session when an outbound message failed", () => {
    const result = step(flowState({ stepId: "cv_info" }), { type: "outbound_failed", at: AT }, c);
    expect(result.effects).toEqual([
      { type: "FlagSession", reason: "outbound_failed", needsAttention: true },
    ]);
  });

  it("says it did not understand and asks again when nlu is unavailable", () => {
    const result = step(flowState({ stepId: "cv_info" }), userTurn("boh"), c);
    expect(sent(result.effects)).toEqual(["system.not_understood", "cv_info"]);
  });

  it("answers with the post-interview help after completion", () => {
    const state = flowState({ phase: "post_completion", stepId: null });
    const result = step(state, userTurn("ciao", interpretation()), c);

    expect(sent(result.effects)).toEqual(["system.post_completion_help"]);
  });
});

describe("step: guards (spec §7.2 point 9, D45)", () => {
  const needsAttention = (reason: string) => [
    { type: "SendText", text: { kind: "system", key: "system.generic_error" } },
    { type: "FlagSession", reason, needsAttention: true },
  ];

  it("never stays silent on an incoherent state, and leaves the state as it was", () => {
    const state = flowState({ stepId: "ghost" });
    const result = step(state, userTurn("ciao"), c);

    expect(result.effects).toEqual(needsAttention("incoherent_state"));
    expect(result.state).toBe(state);
  });

  it("rejects session_started outside the language phase", () => {
    const result = step(flowState({ stepId: "cv_info" }), { type: "session_started", at: AT }, c);
    expect(result.effects).toEqual(needsAttention("incoherent_state"));
  });

  it("stops after 20 automatic advances", () => {
    const long = campaign((input) => {
      input.flow = Array.from({ length: 25 }, (_, i) => ({
        id: `m${i}`,
        type: "message" as const,
        text: { it: `Messaggio ${i}` },
      }));
    });
    const state = initialSessionState();
    const result = step(state, userTurn("italiano"), long);

    expect(result.effects).toEqual(needsAttention("auto_advance_limit"));
    expect(result.state).toBe(state);
  });

  it("is pure: same input, same output, input untouched", () => {
    const state = initialSessionState();
    const event: EngineEvent = userTurn("italiano");
    const before = structuredClone(state);

    expect(step(state, event, c)).toEqual(step(state, event, c));
    expect(state).toEqual(before);
  });
});
