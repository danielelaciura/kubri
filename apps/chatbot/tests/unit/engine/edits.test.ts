import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../../src/engine/interpretation";
import type { EditConfirmation } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import {
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
const atPatente = atQuestion("patente", { profile: { firstName: inferred("Mario") } });
const edit = (field: string, newValue: unknown): Interpretation =>
  interpretation({ intent: "edit_request", editTarget: { field, newValue } });
const pending: EditConfirmation = {
  kind: "edit",
  field: "firstName",
  oldValue: "Mario",
  newValue: "Marco",
};

describe("edit requests during the flow", () => {
  it("asks to confirm, showing the old and the new value", () => {
    const result = step(atPatente, userTurn("mi chiamo Marco", edit("firstName", "Marco")), c);

    expect(result.effects).toEqual([
      {
        type: "SendText",
        text: {
          kind: "system",
          key: "system.confirm_edit",
          params: { field: "firstName", oldValue: "Mario", newValue: "Marco" },
        },
      },
    ]);
    expect(result.state.pendingConfirmation).toEqual(pending);
  });

  it("saves the edit on yes, then resumes the current question", () => {
    const state = { ...atPatente, pendingConfirmation: pending };
    const result = step(state, userTurn("sì", choice("yes")), c);

    expect(others(result.effects)).toEqual(["ApplyPatch:edit:firstName"]);
    expect(sent(result.effects)).toEqual(["system.edit_saved", "anagrafica.patente"]);
    expect(result.state.profile.firstName).toEqual({
      value: "Marco",
      confidence: 1,
      status: "confirmed",
    });
  });

  it("keeps a pending follow-up question after a confirmed edit of another field", () => {
    const state = atQuestion("nome", {
      clarifications: 1,
      profile: { firstName: inferred("Mario") },
      pendingConfirmation: {
        kind: "edit",
        field: "drivingLicense",
        oldValue: null,
        newValue: true,
      },
    });
    const result = step(state, userTurn("sì", choice("yes")), c);

    expect(others(result.effects)).toEqual(["ApplyPatch:edit:drivingLicense"]);
    expect(sent(result.effects)).toEqual(["system.edit_saved", "anagrafica.nome"]);
    expect(result.state).toMatchObject({ questionId: "nome", clarifications: 1 });
  });

  it("moves on after a confirmed edit of the current question's field", () => {
    const state = atQuestion("nome", {
      profile: { firstName: inferred("Mario") },
      pendingConfirmation: pending,
    });
    const result = step(state, userTurn("sì", choice("yes")), c);

    expect(sent(result.effects)).toEqual(["system.edit_saved", "anagrafica.patente"]);
  });

  it("cancels on no, then resumes the current question", () => {
    const state = { ...atPatente, pendingConfirmation: pending };
    const result = step(state, userTurn("no", choice("no")), c);

    expect(sent(result.effects)).toEqual(["system.edit_cancelled", "anagrafica.patente"]);
    expect(result.state.profile.firstName?.value).toBe("Mario");
  });

  it("replaces a pending edit with a corrected value and asks to confirm again", () => {
    const state = { ...atPatente, pendingConfirmation: pending };
    const result = step(state, userTurn("no, è Marcello", edit("firstName", "Marcello")), c);

    expect(sent(result.effects)).toEqual(["system.confirm_edit"]);
    expect(others(result.effects)).toEqual([]);
    expect(result.state.pendingConfirmation).toEqual({ ...pending, newValue: "Marcello" });
    expect(result.state.profile.firstName?.value).toBe("Mario");
  });

  it("rejects an invalid value and resumes", () => {
    const result = step(atPatente, userTurn("cambia", edit("drivingLicense", "forse")), c);
    expect(sent(result.effects)).toEqual(["system.edit_invalid", "anagrafica.patente"]);
  });

  it("rejects an edit without a target", () => {
    const result = step(
      atPatente,
      userTurn("cambia", interpretation({ intent: "edit_request" })),
      c,
    );
    expect(sent(result.effects)).toEqual(["system.edit_invalid", "anagrafica.patente"]);
  });

  it("rejects edits before the consent threshold", () => {
    const result = step(
      flowState({ stepId: "cv_info" }),
      userTurn("mi chiamo Marco", edit("firstName", "Marco")),
      c,
    );
    expect(sent(result.effects)).toEqual(["system.edit_invalid", "cv_info"]);
  });
});
