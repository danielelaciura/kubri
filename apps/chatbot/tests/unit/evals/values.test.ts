import { describe, expect, it } from "vitest";
import { valuesMatch } from "../../../src/evals/values";
import { resolveField } from "../../../src/profile/field-ref";

const def = (ref: string) => resolveField(ref, []);

describe("valuesMatch (D94)", () => {
  it.each([
    ["drivingLicense", true, true, true],
    ["drivingLicense", true, "true", false],
    ["italianLevel", "intermedio", "intermedio", true],
    ["italianLevel", "intermedio", "Intermedio", false],
    ["birthday", "1985-03-03", "1985-03-03", true],
    ["birthday", "1985-03-03", "03/03/1985", false],
  ])("%s: %j vs %j → %s (exact)", (field, expected, actual, ok) => {
    expect(valuesMatch(def(field), expected, actual)).toBe(ok);
  });

  it("compares plain text normalized, not exact", () => {
    expect(valuesMatch(def("location"), "Forlì", "forli")).toBe(true);
    expect(valuesMatch(def("location"), "Forlì", "Cesena")).toBe(false);
  });

  it("compares ISO-formatted text exactly", () => {
    expect(valuesMatch(def("country"), "MA", "MA")).toBe(true);
    expect(valuesMatch(def("country"), "MA", "ma")).toBe(false);
    expect(valuesMatch(def("language"), "ar", "ar")).toBe(true);
  });

  it("compares numbers with a tiny tolerance", () => {
    const number = { key: "custom.x", type: "number", description: "" } as const;
    expect(valuesMatch(number, 0.1 + 0.2, 0.3)).toBe(true);
    expect(valuesMatch(number, 3, "3")).toBe(false);
  });

  it("compares lists as normalized sets", () => {
    expect(valuesMatch(def("drivingLicenseTypes"), ["B", "C"], ["c", "b"])).toBe(true);
    expect(valuesMatch(def("drivingLicenseTypes"), ["B", "C"], ["B"])).toBe(false);
    expect(valuesMatch(def("skillsAndCompetences"), ["pulizie"], "pulizie")).toBe(false);
  });

  it("compares work and study lists by parts", () => {
    expect(
      valuesMatch(
        def("workExperience"),
        ["2018 - 2020 Bologna: Magazziniere"],
        ["2018 - 2020 bologna (Italia): magazziniere"],
      ),
    ).toBe(true);
    expect(
      valuesMatch(def("workExperience"), ["2018 - 2020 Bologna: Magazziniere"], ["magazziniere"]),
    ).toBe(false);
  });

  it("falls back to identity for a field with no definition", () => {
    expect(valuesMatch(undefined, "x", "x")).toBe(true);
    expect(valuesMatch(undefined, "x", "y")).toBe(false);
  });
});
