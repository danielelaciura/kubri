import { describe, expect, it } from "vitest";
import { describeEffect } from "../../../src/engine/describe";
import type { Effect } from "../../../src/engine/effects";

const AT = "2026-10-24T10:00:00.000Z";

describe("describeEffect", () => {
  it.each([
    [
      { type: "SendText", text: { kind: "system", key: "system.welcome" } },
      "SendText:system.welcome",
    ],
    [
      {
        type: "ApplyPatch",
        source: "extraction",
        fields: [
          { field: "firstName", value: "Mario", confidence: 0.9, status: "inferred" },
          { field: "drivingLicense", value: true, confidence: 0.9, status: "inferred" },
        ],
      },
      "ApplyPatch:extraction:firstName,drivingLicense",
    ],
    [
      {
        type: "RecordPatchRejections",
        rejected: [{ field: "phone", reason: "system_only_field" }],
      },
      "RecordPatchRejections:phone=system_only_field",
    ],
    [
      {
        type: "RecordPatchRejections",
        rejected: [
          { field: "Mario Rossi via Roma 1", reason: "unknown_field" },
          { field: "firstName", reason: "invalid_value" },
        ],
      },
      "RecordPatchRejections:<unknown>=unknown_field,firstName=invalid_value",
    ],
    [{ type: "MarkFieldUnresolved", field: "firstName" }, "MarkFieldUnresolved:firstName"],
    [
      {
        type: "RecordConsent",
        stepId: "privacy",
        consentKey: "acme_privacy",
        textVersion: "2026-10",
        text: { kind: "system", key: "system.welcome" },
        dataController: { name: "ACME", privacyUrl: "https://example.com/privacy" },
        language: "it",
        outcome: "accepted",
        at: AT,
      },
      "RecordConsent:acme_privacy:accepted",
    ],
    [{ type: "SetLanguage", language: "ar" }, "SetLanguage:ar"],
    [{ type: "CompleteSession", at: AT }, "CompleteSession"],
    [
      { type: "StopSession", reason: "opt_out", dataPolicy: "keep", at: AT },
      "StopSession:opt_out:keep",
    ],
    [{ type: "OptOut", at: AT }, "OptOut"],
    [
      { type: "EnqueueJob", job: { name: "kubri-webhook", event: "block.completed" } },
      "EnqueueJob:kubri-webhook:block.completed",
    ],
    [{ type: "EnqueueJob", job: { name: "cv" } }, "EnqueueJob:cv"],
    [
      {
        type: "FlagSession",
        reason: "unresolved_field",
        needsAttention: false,
        field: "firstName",
      },
      "FlagSession:unresolved_field:firstName",
    ],
    [
      { type: "FlagSession", reason: "incoherent_state", needsAttention: true },
      "FlagSession:incoherent_state",
    ],
  ] as [Effect, string][])("%j → %s", (effect, description) => {
    expect(describeEffect(effect)).toBe(description);
  });

  it("never includes values (they are personal data)", () => {
    const effect: Effect = {
      type: "ApplyPatch",
      source: "edit",
      fields: [{ field: "firstName", value: "Mario", confidence: 1, status: "confirmed" }],
    };
    expect(describeEffect(effect)).not.toContain("Mario");
  });
});
