import { describe, expect, it } from "vitest";
import { ChoiceOptionSchema, MAX_CHOICE_LABEL_LENGTH } from "../../../src/campaigns/schema/steps";

const OPTION = { id: "magazzino", description: "Vuole lavorare in magazzino" };

describe("ChoiceOptionSchema label (D113)", () => {
  it("is optional: existing campaigns do not change", () => {
    expect(ChoiceOptionSchema.parse(OPTION)).toEqual(OPTION);
  });

  it("accepts a localized label with Italian", () => {
    const parsed = ChoiceOptionSchema.parse({
      ...OPTION,
      label: { it: "Magazzino", en: "Warehouse" },
    });

    expect(parsed.label).toEqual({ it: "Magazzino", en: "Warehouse" });
  });

  it("holds at most 24 Italian characters, the length of a list row", () => {
    expect(MAX_CHOICE_LABEL_LENGTH).toBe(24);
    expect(() =>
      ChoiceOptionSchema.parse({ ...OPTION, label: { it: "x".repeat(24) } }),
    ).not.toThrow();
    expect(() => ChoiceOptionSchema.parse({ ...OPTION, label: { it: "x".repeat(25) } })).toThrow(
      /24/,
    );
  });

  it("needs the Italian text like every localized text", () => {
    expect(() => ChoiceOptionSchema.parse({ ...OPTION, label: { en: "Warehouse" } })).toThrow();
  });
});
