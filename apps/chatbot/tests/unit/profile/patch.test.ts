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

  it("rejects every entry of a field that appears twice", () => {
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
});
