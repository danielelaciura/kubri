import { describe, expect, it } from "vitest";
import { initialSessionState, type SessionState } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import {
  answer,
  atQuestion,
  campaign,
  choice,
  flowState,
  inferred,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const c = campaign();
const keep = campaign((input) => {
  input.onStop = { data: "keep" };
});
const wipe = campaign((input) => {
  input.onStop = { data: "delete" };
});
const completed = flowState({
  phase: "post_completion",
  stepId: null,
  consentsAccepted: true,
  profile: { firstName: inferred("Mario") },
});
const closed = flowState({ phase: "closed", stepId: null });
const asked = (state: SessionState): SessionState => ({
  ...state,
  pendingConfirmation: { kind: "delete_data" },
});

describe("opt_out", () => {
  it("works without the LLM and deletes everything before the threshold", () => {
    const result = step(flowState({ stepId: "cv_info" }), userTurn("STOP!"), c);

    expect(sent(result.effects)).toEqual(["system.opt_out_confirm"]);
    expect(others(result.effects)).toEqual(["StopSession:opt_out:delete", "OptOut"]);
    expect(result.state.phase).toBe("closed");
  });

  it("keeps the data after the threshold by default (D57)", () => {
    const interp = interpretation({ intent: "opt_out" });
    const result = step(atQuestion("nome"), userTurn("non voglio più", interp), c);

    expect(others(result.effects)).toEqual(["StopSession:opt_out:keep", "OptOut"]);
  });

  it("deletes after the threshold when the campaign sets onStop delete", () => {
    const interp = interpretation({ intent: "opt_out" });
    const result = step(atQuestion("nome"), userTurn("basta", interp), wipe);

    expect(others(result.effects)).toEqual(["StopSession:opt_out:delete", "OptOut"]);
  });

  it("deletes before the threshold even when onStop is keep (D24)", () => {
    const result = step(flowState({ stepId: "cv_info" }), userTurn("STOP!"), keep);

    expect(others(result.effects)).toEqual(["StopSession:opt_out:delete", "OptOut"]);
  });

  it("wins over an answer extracted by the LLM, which is never saved", () => {
    const result = step(atQuestion("nome"), userTurn("stop", answer("firstName", "Stop")), c);

    expect(others(result.effects)).toEqual(["StopSession:opt_out:keep", "OptOut"]);
  });

  it("wins over a pending value confirmation", () => {
    const state = atQuestion("nome", {
      pendingConfirmation: { kind: "value", field: "firstName", value: "Mrio", confidence: 0.4 },
    });
    const result = step(state, userTurn("basta"), c);

    expect(others(result.effects)).toEqual(["StopSession:opt_out:keep", "OptOut"]);
    expect(result.state.pendingConfirmation).toBeNull();
  });

  it("works in the language phase", () => {
    const result = step(initialSessionState(), userTurn("basta"), c);
    expect(others(result.effects)).toEqual(["StopSession:opt_out:delete", "OptOut"]);
  });

  it("keeps the data of a completed interview (D39)", () => {
    const result = step(completed, userTurn("stop"), c);

    expect(sent(result.effects)).toEqual(["system.opt_out_confirm"]);
    expect(others(result.effects)).toEqual(["OptOut"]);
    expect(result.state.phase).toBe("closed");
  });

  it("is recorded in a closed session too", () => {
    const result = step(closed, userTurn("stop"), c);

    expect(sent(result.effects)).toEqual(["system.opt_out_confirm"]);
    expect(others(result.effects)).toEqual(["OptOut"]);
  });
});

describe("delete_data asks for a confirmation first", () => {
  it("touches nothing on the request, from the keyword", () => {
    const result = step(atQuestion("nome"), userTurn("Cancella i miei dati"), keep);

    expect(sent(result.effects)).toEqual(["system.delete_confirm"]);
    expect(others(result.effects)).toEqual([]);
    expect(result.state).toMatchObject({
      phase: "flow",
      stepId: "anagrafica",
      questionId: "nome",
      pendingConfirmation: { kind: "delete_data" },
    });
  });

  it("touches nothing on the request, from the LLM, even with extracted data", () => {
    const interp = interpretation({
      intent: "delete_data",
      patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
    });
    const result = step(atQuestion("nome"), userTurn("sono Mario, toglietemi tutto", interp), c);

    expect(sent(result.effects)).toEqual(["system.delete_confirm"]);
    expect(others(result.effects)).toEqual([]);
    expect(result.state.profile).toEqual({});
  });

  it("deletes on yes, even after the threshold with onStop keep", () => {
    const result = step(asked(atQuestion("nome")), userTurn("sì", choice("yes")), keep);

    expect(sent(result.effects)).toEqual(["system.delete_done"]);
    expect(others(result.effects)).toEqual([
      "EnqueueJob:delete-contact",
      "StopSession:delete_data:delete",
    ]);
    expect(result.state).toMatchObject({ phase: "closed", pendingConfirmation: null });
  });

  it("accepts a deterministic yes without the LLM", () => {
    const result = step(asked(atQuestion("nome")), userTurn("Sì!"), c);

    expect(others(result.effects)).toEqual([
      "EnqueueJob:delete-contact",
      "StopSession:delete_data:delete",
    ]);
  });

  it("takes a repeated deletion request as a yes", () => {
    const result = step(asked(atQuestion("nome")), userTurn("cancellami"), c);

    expect(sent(result.effects)).toEqual(["system.delete_done"]);
  });

  it("cancels on anything else and resumes, without processing the message", () => {
    const state = asked(atQuestion("nome"));
    const result = step(state, userTurn("Mario", answer("firstName", "Mario")), c);

    expect(sent(result.effects)).toEqual(["system.delete_cancelled", "anagrafica.nome"]);
    expect(others(result.effects)).toEqual([]);
    expect(result.state).toMatchObject({ phase: "flow", pendingConfirmation: null });
    expect(result.state.profile).toEqual({});
  });

  it("cancels on no", () => {
    const result = step(asked(atQuestion("nome")), userTurn("no", choice("no")), c);
    expect(sent(result.effects)).toEqual(["system.delete_cancelled", "anagrafica.nome"]);
  });

  it("cancels and stops on an opt-out", () => {
    const result = step(asked(atQuestion("nome")), userTurn("stop"), c);

    expect(sent(result.effects)).toEqual(["system.delete_cancelled", "system.opt_out_confirm"]);
    expect(others(result.effects)).toEqual(["StopSession:opt_out:keep", "OptOut"]);
  });

  it("works in the language phase", () => {
    const first = step(initialSessionState(), userTurn("cancellami"), c);
    expect(sent(first.effects)).toEqual(["system.delete_confirm"]);
    expect(first.state.phase).toBe("language");

    const yes = step(first.state, userTurn("sì", choice("yes")), c);
    expect(others(yes.effects)).toEqual([
      "EnqueueJob:delete-contact",
      "StopSession:delete_data:delete",
    ]);

    const no = step(first.state, userTurn("italiano"), c);
    expect(sent(no.effects)).toEqual(["system.delete_cancelled", "system.welcome"]);
    expect(no.state.phase).toBe("language");
  });

  it("deletes a completed interview", () => {
    const first = step(completed, userTurn("cancellami"), c);
    expect(sent(first.effects)).toEqual(["system.delete_confirm"]);
    expect(first.state.phase).toBe("post_completion");

    const result = step(first.state, userTurn("sì", choice("yes")), c);
    expect(sent(result.effects)).toEqual(["system.delete_done"]);
    expect(others(result.effects)).toEqual(["EnqueueJob:delete-contact"]);
    expect(result.state.phase).toBe("closed");
  });

  it("goes back to the completed interview on cancel", () => {
    const result = step(asked(completed), userTurn("no", choice("no")), c);

    expect(sent(result.effects)).toEqual(["system.delete_cancelled"]);
    expect(result.state).toMatchObject({ phase: "post_completion", pendingConfirmation: null });
  });

  it("is still possible in a closed session (D40)", () => {
    const first = step(closed, userTurn("cancellami"), c);
    expect(sent(first.effects)).toEqual(["system.delete_confirm"]);
    expect(first.state).toMatchObject({
      phase: "closed",
      pendingConfirmation: { kind: "delete_data" },
    });

    const result = step(first.state, userTurn("sì", choice("yes")), c);
    expect(sent(result.effects)).toEqual(["system.delete_done"]);
    expect(others(result.effects)).toEqual(["EnqueueJob:delete-contact"]);

    const cancelled = step(first.state, userTurn("ciao"), c);
    expect(sent(cancelled.effects)).toEqual(["system.delete_cancelled"]);
  });

  it.each([
    ["flow", asked(atQuestion("nome", { profile: { firstName: inferred("Mario") } }))],
    ["post_completion", asked(completed)],
    ["closed", asked({ ...closed, profile: { firstName: inferred("Mario") } })],
  ] as const)("clears the profile from the engine state when confirmed in %s", (_phase, state) => {
    const result = step(state, userTurn("sì", choice("yes")), c);

    expect(result.state).toMatchObject({ phase: "closed", pendingConfirmation: null });
    expect(result.state.profile).toEqual({});
  });
});
