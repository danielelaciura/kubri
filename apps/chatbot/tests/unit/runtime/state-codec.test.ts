import { describe, expect, it } from "vitest";
import { decodeState, encodeState, STATE_FORMAT_VERSION } from "../../../src/runtime/state-codec";
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

  it("writes the format version", () => {
    expect(encodeState(STATE)).toMatchObject({ v: STATE_FORMAT_VERSION });
    expect(STATE_FORMAT_VERSION).toBe(1);
  });

  it("decodes a legacy state without `v` and with a key it does not know", () => {
    const { v: _v, ...legacy } = encodeState(STATE);
    const dropped: string[] = [];

    const decoded = decodeState({ ...legacy, mood: "happy" }, STATE.profile, {
      onDropped: (what) => dropped.push(what),
    });

    expect(decoded).toEqual(STATE);
    expect(decoded).not.toHaveProperty("mood");
    expect(decoded).not.toHaveProperty("v");
    expect(dropped).toEqual([]);
  });

  it("fills the fields an older state did not have with their defaults", () => {
    const decoded = decodeState({ phase: "flow", stepId: "anagrafica", questionId: "nome" }, {});

    expect(decoded).toEqual({
      ...initialSessionState(),
      phase: "flow",
      stepId: "anagrafica",
      questionId: "nome",
    });
  });

  it.each([
    ["an unknown kind", { kind: "teleport", field: "x" }],
    ["a broken known kind", { kind: "value", field: 3 }],
  ])("drops a pending confirmation with %s and reports it, keeping the rest", (_n, pending) => {
    const dropped: string[] = [];

    const decoded = decodeState(
      { ...encodeState(STATE), pendingConfirmation: pending },
      STATE.profile,
      { onDropped: (what) => dropped.push(what) },
    );

    expect(decoded).toEqual({ ...STATE, pendingConfirmation: null });
    expect(dropped).toEqual(["pendingConfirmation"]);
  });

  it("keeps the extra keys of a pending confirmation out", () => {
    const decoded = decodeState(
      { ...encodeState(STATE), pendingConfirmation: { kind: "delete_data", extra: 1 } },
      {},
    );

    expect(decoded.pendingConfirmation).toEqual({ kind: "delete_data" });
  });

  it.each([
    ["not an object", "oops"],
    ["an unknown phase", { ...encodeState(STATE), phase: "dancing" }],
    ["a missing phase", { stepId: null }],
    ["a bad language", { ...encodeState(STATE), language: "ARABIC" }],
  ])("refuses %s", (_name, json) => {
    expect(() => decodeState(json, {})).toThrow(/engine state/);
  });
});
