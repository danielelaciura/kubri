import { describe, expect, it } from "vitest";
import type { PatchEntry } from "../../../src/profile/patch";
import { applyExtractedPatch, applyFields } from "../../../src/engine/patches";
import type { SessionState } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import { createTurn, type Turn } from "../../../src/engine/turn";
import {
  AT,
  atQuestion,
  campaign,
  flowState,
  inferred,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const entry = (field: string, value: unknown, confidence = 0.9): PatchEntry => ({
  field,
  value,
  confidence,
  evidence: "…",
});
const turnFor = (state: SessionState): Turn => createTurn(state, campaign(), AT);

describe("applyExtractedPatch", () => {
  it("saves every confident valid value, asked or not, as inferred", () => {
    const turn = turnFor(atQuestion("nome"));
    const low = applyExtractedPatch(
      turn,
      [entry("firstName", "Mario"), entry("custom.night_shifts", true)],
      "firstName",
    );

    expect(low).toBeUndefined();
    expect(turn.effects).toEqual([
      {
        type: "ApplyPatch",
        source: "extraction",
        fields: [
          { field: "firstName", value: "Mario", confidence: 0.9, status: "inferred" },
          { field: "custom.night_shifts", value: true, confidence: 0.9, status: "inferred" },
        ],
      },
    ]);
    expect(turn.state.profile).toEqual({
      firstName: { value: "Mario", confidence: 0.9, status: "inferred" },
      "custom.night_shifts": { value: true, confidence: 0.9, status: "inferred" },
    });
  });

  it("saves nothing before the consent threshold", () => {
    const turn = turnFor(atQuestion("nome", { consentsAccepted: false }));
    applyExtractedPatch(turn, [entry("firstName", "Mario")], "firstName");

    expect(turn.effects).toEqual([]);
    expect(turn.state.profile).toEqual({});
  });

  it("records rejected entries without their values", () => {
    const turn = turnFor(atQuestion("nome"));
    applyExtractedPatch(
      turn,
      [entry("phone", "+393331234567"), entry("drivingLicense", "sì")],
      "firstName",
    );

    expect(turn.effects).toEqual([
      {
        type: "RecordPatchRejections",
        rejected: [
          { field: "phone", reason: "system_only_field" },
          { field: "drivingLicense", reason: "invalid_value" },
        ],
      },
    ]);
  });

  it("never overwrites a filled field other than the current question's", () => {
    const turn = turnFor(atQuestion("patente", { profile: { firstName: inferred("Mario") } }));
    applyExtractedPatch(turn, [entry("firstName", "Luigi", 0.99)], "drivingLicense");

    expect(turn.effects).toEqual([]);
  });

  it("may overwrite the current question's field (completing a partial answer)", () => {
    const turn = turnFor(atQuestion("nome", { profile: { firstName: inferred("Mario") } }));
    applyExtractedPatch(turn, [entry("firstName", "Mario Rossi")], "firstName");

    expect(others(turn.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
  });

  it("fills an unresolved field", () => {
    const turn = turnFor(
      atQuestion("nome", {
        profile: { drivingLicense: { value: null, confidence: 0, status: "unresolved" } },
      }),
    );
    applyExtractedPatch(turn, [entry("drivingLicense", true)], "firstName");

    expect(others(turn.effects)).toEqual(["ApplyPatch:extraction:drivingLicense"]);
  });

  it("returns a low-confidence value for the current field instead of saving it", () => {
    const turn = turnFor(atQuestion("nome"));
    const low = applyExtractedPatch(turn, [entry("firstName", "Mrio", 0.4)], "firstName");

    expect(low).toEqual(entry("firstName", "Mrio", 0.4));
    expect(turn.effects).toEqual([]);
  });

  it("drops a low-confidence value for another field", () => {
    const turn = turnFor(atQuestion("nome"));
    const low = applyExtractedPatch(turn, [entry("drivingLicense", true, 0.4)], "firstName");

    expect(low).toBeUndefined();
    expect(turn.effects).toEqual([]);
  });

  it("enqueues geocoding when the address changes (spec §12.3)", () => {
    const turn = turnFor(atQuestion("nome"));
    applyExtractedPatch(turn, [entry("address", "Via Roma 1, Milano")], "firstName");

    expect(others(turn.effects)).toEqual(["ApplyPatch:extraction:address", "EnqueueJob:geocoding"]);
  });
});

describe("applyFields", () => {
  it("does nothing with no fields", () => {
    const turn = turnFor(flowState());
    applyFields(turn, "edit", []);
    expect(turn.effects).toEqual([]);
  });
});

describe("step applies patches on any waiting step", () => {
  it("saves values given while answering a choice", () => {
    const state = flowState({ stepId: "cv_info", consentsAccepted: true });
    const interp = interpretation({
      intent: "choice",
      choice: "yes",
      patch: [entry("firstName", "Mario")],
    });
    const result = step(state, userTurn("sì, sono Mario", interp), campaign());

    expect(others(result.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
    expect(sent(result.effects)).toEqual(["privacy"]);
  });
});
