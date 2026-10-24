import { describe, expect, it } from "vitest";
import type { EditConfirmation, ValueConfirmation } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import {
  answer,
  atQuestion,
  campaign,
  choice,
  flowState,
  inferred,
  others,
  sent,
  userTurn,
} from "./helpers";

const c = campaign();
const value: ValueConfirmation = {
  kind: "value",
  field: "firstName",
  value: "Mrio",
  confidence: 0.4,
};
const edit: EditConfirmation = {
  kind: "edit",
  field: "firstName",
  oldValue: "Mario",
  newValue: "Marco",
};
const atPatente = atQuestion("patente", {
  profile: { firstName: inferred("Mario") },
  pendingConfirmation: edit,
});
const completed = flowState({
  phase: "post_completion",
  stepId: null,
  consentsAccepted: true,
  profile: { firstName: inferred("Mario") },
  pendingConfirmation: edit,
});

describe("deterministic yes/no on a pending value", () => {
  const state = atQuestion("nome", { pendingConfirmation: value });

  it("confirms on a yes keyword without the LLM", () => {
    const result = step(state, userTurn("Sì!"), c);

    expect(others(result.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
    expect(result.state.profile.firstName?.value).toBe("Mrio");
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
  });

  it("lets the yes keyword win over the LLM reading it as a field value", () => {
    const result = step(state, userTurn("Sì", answer("firstName", "Sì")), c);

    expect(result.state.profile.firstName).toEqual({
      value: "Mrio",
      confidence: 1,
      status: "confirmed",
    });
  });

  it("cancels on a no keyword without the LLM", () => {
    const result = step(state, userTurn("no"), c);

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["anagrafica.nome"]);
    expect(result.state.pendingConfirmation).toBeNull();
  });

  it("lets the no keyword win over the LLM", () => {
    const result = step(state, userTurn("No", choice("yes")), c);
    expect(others(result.effects)).toEqual([]);
  });
});

describe("deterministic yes/no on a pending edit", () => {
  it("saves on ok during the flow", () => {
    const result = step(atPatente, userTurn("ok"), c);
    expect(others(result.effects)).toEqual(["ApplyPatch:edit:firstName"]);
  });

  it("cancels on nope during the flow", () => {
    const result = step(atPatente, userTurn("nope"), c);
    expect(sent(result.effects)).toEqual(["system.edit_cancelled", "anagrafica.patente"]);
  });

  it("saves on sì after completion", () => {
    const result = step(completed, userTurn("sì", answer("firstName", "Sì")), c);
    expect(others(result.effects)).toEqual([
      "ApplyPatch:edit:firstName",
      "EnqueueJob:kubri-webhook:profile.updated",
    ]);
  });

  it("cancels on no after completion", () => {
    const result = step(completed, userTurn("no"), c);
    expect(sent(result.effects)).toEqual(["system.edit_cancelled"]);
  });
});

describe("deterministic yes/no on a pending deletion", () => {
  const state = atQuestion("nome", { pendingConfirmation: { kind: "delete_data" } });

  it("lets the no keyword win over an LLM yes", () => {
    const result = step(state, userTurn("non", choice("yes")), c);

    expect(sent(result.effects)).toEqual(["system.delete_cancelled", "anagrafica.nome"]);
    expect(others(result.effects)).toEqual([]);
  });

  it("lets the yes keyword win over an LLM no", () => {
    const result = step(state, userTurn("sì", choice("no")), c);
    expect(sent(result.effects)).toEqual(["system.delete_done"]);
  });
});
