import { describe, expect, it } from "vitest";
import { CustomFieldDefinitionSchema } from "../../../src/profile/custom-fields";
import { resolveField } from "../../../src/profile/field-ref";

const custom = [
  CustomFieldDefinitionSchema.parse({
    key: "night_shifts",
    type: "bool",
    label: { it: "Turni notturni" },
    description: "Disponibile a lavorare di notte.",
  }),
];

describe("resolveField", () => {
  it("resolves standard fields", () => {
    expect(resolveField("drivingLicense", custom)?.type).toBe("bool");
  });

  it("resolves declared custom fields", () => {
    expect(resolveField("custom.night_shifts", custom)?.key).toBe("custom.night_shifts");
  });

  it("returns undefined for undeclared custom fields", () => {
    expect(resolveField("custom.unknown", custom)).toBeUndefined();
  });

  it("returns undefined for unknown standard fields", () => {
    expect(resolveField("nickname", custom)).toBeUndefined();
  });
});
