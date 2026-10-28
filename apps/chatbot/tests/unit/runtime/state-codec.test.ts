import { describe, expect, it } from "vitest";
import { decodeState, encodeState } from "../../../src/runtime/state-codec";
import { initialSessionState, type SessionState } from "../../../src/engine/state";
import { inferred } from "../engine/helpers";

const STATE: SessionState = {
  ...initialSessionState(),
  phase: "flow",
  stepId: "anagrafica",
  questionId: "nome",
  clarifications: 1,
  language: "ar",
  consentsAccepted: true,
  outcomes: { privacy: "accepted" },
  pendingConfirmation: { kind: "edit", field: "location", oldValue: "Bo", newValue: "Mo" },
  profile: { firstName: inferred("Mario") },
};

describe("encodeState and decodeState", () => {
  it("leaves the profile out when saving (D104)", () => {
    const encoded = encodeState(STATE);

    expect(encoded).not.toHaveProperty("profile");
    expect(JSON.stringify(encoded)).not.toContain("Mario");
  });

  it("round-trips through JSON with the hydrated profile", () => {
    const json: unknown = JSON.parse(JSON.stringify(encodeState(STATE)));

    expect(decodeState(json, STATE.profile)).toEqual(STATE);
  });

  it.each([
    ["a value confirmation", { kind: "value", field: "firstName", value: "Mrio", confidence: 0.5 }],
    ["a deletion", { kind: "delete_data" }],
  ] as const)("keeps %s", (_name, pendingConfirmation) => {
    const state = { ...STATE, pendingConfirmation };

    const decoded = decodeState(JSON.parse(JSON.stringify(encodeState(state))), {});

    expect(decoded.pendingConfirmation).toEqual(pendingConfirmation);
  });

  it.each([
    ["not an object", "oops"],
    ["an unknown phase", { ...encodeState(STATE), phase: "dancing" }],
    ["an unknown key", { ...encodeState(STATE), mood: "happy" }],
    ["a bad language", { ...encodeState(STATE), language: "ARABIC" }],
  ])("refuses %s", (_name, json) => {
    expect(() => decodeState(json, {})).toThrow(/engine state/);
  });
});
