import { describe, expect, it } from "vitest";
import { CustomFieldDefinitionSchema } from "../../../src/profile/custom-fields";
import { validatePatch, type PatchEntry } from "../../../src/profile/patch";

const custom = [
  CustomFieldDefinitionSchema.parse({
    key: "night_shifts",
    type: "bool",
    label: { it: "Turni notturni" },
    description: "Disponibile a lavorare di notte.",
  }),
];

const entry = (field: string, value: unknown, confidence = 0.9): PatchEntry => ({
  field,
  value,
  confidence,
  evidence: "…",
});

describe("validatePatch", () => {
  it("accepts valid standard and custom values, normalized by the schema", () => {
    const result = validatePatch(
      [entry("firstName", "  Mario "), entry("custom.night_shifts", true)],
      custom,
    );

    expect(result.rejected).toEqual([]);
    expect(result.accepted.map((e) => [e.field, e.value])).toEqual([
      ["firstName", "Mario"],
      ["custom.night_shifts", true],
    ]);
  });

  it("rejects unknown fields", () => {
    const result = validatePatch([entry("nickname", "Super Mario")], custom);
    expect(result.rejected).toEqual([{ field: "nickname", reason: "unknown_field" }]);
  });

  it("rejects system-only fields", () => {
    const result = validatePatch([entry("phone", "+393331234567")], custom);
    expect(result.rejected).toEqual([{ field: "phone", reason: "system_only_field" }]);
  });

  it("rejects values of the wrong type without echoing them", () => {
    const result = validatePatch([entry("drivingLicense", "sì")], custom);
    expect(result.rejected).toEqual([{ field: "drivingLicense", reason: "invalid_value" }]);
    expect(JSON.stringify(result.rejected)).not.toContain("sì");
  });

  it.each([-0.1, 1.1, Number.NaN])("rejects confidence %s", (confidence) => {
    const result = validatePatch([entry("firstName", "Mario", confidence)], custom);
    expect(result.rejected[0]?.reason).toBe("invalid_confidence");
  });

  it("rejects every entry of a field that appears twice with conflicting values", () => {
    const result = validatePatch(
      [entry("firstName", "Mario"), entry("firstName", "Luigi")],
      custom,
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { field: "firstName", reason: "duplicate_field" },
      { field: "firstName", reason: "duplicate_field" },
    ]);
  });

  it("collapses duplicates with identical values, keeping the highest confidence", () => {
    const result = validatePatch(
      [
        entry("firstName", "Mario", 0.6),
        entry("firstName", " Mario ", 0.95),
        entry("firstName", "Mario", 0.8),
      ],
      custom,
    );
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toMatchObject({
      field: "firstName",
      value: "Mario",
      confidence: 0.95,
    });
  });

  it("collapses identical list values by deep equality", () => {
    const result = validatePatch(
      [
        entry("drivingLicenseTypes", ["B", "C"], 0.7),
        entry("drivingLicenseTypes", ["B", "C"], 0.9),
      ],
      custom,
    );
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.confidence).toBe(0.9);
  });

  it("truncates the field name of rejections to 64 characters", () => {
    const long = "x".repeat(500);
    const result = validatePatch([entry(long, "v")], custom);
    expect(result.rejected).toEqual([{ field: "x".repeat(64), reason: "unknown_field" }]);
  });
});
