import { describe, expect, it } from "vitest";
import type { ValueConfirmation } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import {
  answer,
  atQuestion,
  campaign,
  choice,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const c = campaign();
const pending: ValueConfirmation = {
  kind: "value",
  field: "firstName",
  value: "Mrio",
  confidence: 0.4,
};

describe("low-confidence values", () => {
  it("asks for a confirmation instead of saving", () => {
    const interp = interpretation({
      patch: [{ field: "firstName", value: "Mrio", confidence: 0.4, evidence: "Mrio" }],
      currentQuestion: { completeness: "complete" },
    });
    const result = step(atQuestion("nome"), userTurn("Mrio", interp), c);

    expect(result.effects).toEqual([
      {
        type: "SendText",
        text: {
          kind: "system",
          key: "system.confirm_value",
          params: { field: "firstName", value: "Mrio" },
        },
      },
    ]);
    expect(result.state.pendingConfirmation).toEqual(pending);
  });

  it("saves the value as confirmed on yes and moves on", () => {
    const state = atQuestion("nome", { pendingConfirmation: pending });
    const result = step(state, userTurn("sì", choice("yes")), c);

    expect(others(result.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
    expect(result.state.profile.firstName).toEqual({
      value: "Mrio",
      confidence: 1,
      status: "confirmed",
    });
    expect(result.state.pendingConfirmation).toBeNull();
  });

  it("drops the value on no and asks the question again", () => {
    const state = atQuestion("nome", { pendingConfirmation: pending });
    const result = step(state, userTurn("no", choice("no")), c);

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["anagrafica.nome"]);
    expect(result.state).toMatchObject({ pendingConfirmation: null, clarifications: 0 });
  });

  it("drops the confirmation and handles any other message as a fresh answer (D36)", () => {
    const state = atQuestion("nome", { pendingConfirmation: pending });
    const result = step(state, userTurn("Marco", answer("firstName", "Marco")), c);

    expect(others(result.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
    expect(result.state.profile.firstName?.value).toBe("Marco");
  });
});
