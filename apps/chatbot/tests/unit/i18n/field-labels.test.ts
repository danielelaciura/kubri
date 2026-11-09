import { describe, expect, it } from "vitest";
import { fieldLabel, STANDARD_FIELD_LABELS } from "../../../src/i18n/field-labels";
import { STANDARD_FIELD_DEFINITIONS } from "../../../src/profile/standard-fields";

const CUSTOM = [
  {
    key: "night_shifts",
    type: "bool" as const,
    label: { it: "Turni notturni", en: "Night shifts" },
    description: "Disponibile di notte.",
  },
];

describe("field labels", () => {
  it.each(STANDARD_FIELD_DEFINITIONS.map((f) => f.key))("%s has an Italian label", (key) => {
    expect(fieldLabel(key, [])?.["it"]).toMatch(/\S/);
  });

  it("has no label for a field that does not exist", () => {
    expect(Object.keys(STANDARD_FIELD_LABELS).sort()).toEqual(
      STANDARD_FIELD_DEFINITIONS.map((f) => f.key).sort(),
    );
  });

  it("uses the campaign label of a custom field", () => {
    expect(fieldLabel("custom.night_shifts", CUSTOM)).toEqual({
      it: "Turni notturni",
      en: "Night shifts",
    });
  });

  it("has no label for an unknown field", () => {
    expect(fieldLabel("custom.nope", CUSTOM)).toBeUndefined();
    expect(fieldLabel("nope", [])).toBeUndefined();
  });
});
