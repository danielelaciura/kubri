import { describe, expect, it } from "vitest";
import type { FieldFormat, FieldType } from "../../../src/profile/field-definition";
import {
  ITALIAN_LEVELS,
  STANDARD_FIELD_DEFINITIONS,
  getStandardField,
} from "../../../src/profile/standard-fields";

interface Expected {
  readonly key: string;
  readonly type: FieldType;
  readonly format?: FieldFormat;
  readonly systemOnly?: true;
}

// Spec §6, one row per standard field. A removed, added or retyped field must fail here.
const SPEC: readonly Expected[] = [
  { key: "firstName", type: "text" },
  { key: "lastName", type: "text" },
  { key: "birthday", type: "date" },
  { key: "country", type: "text", format: "iso-country" },
  { key: "address", type: "text" },
  { key: "location", type: "text" },
  { key: "lat", type: "number", systemOnly: true },
  { key: "lng", type: "number", systemOnly: true },
  { key: "phone", type: "text", format: "e164", systemOnly: true },
  { key: "email", type: "text", format: "email" },
  { key: "language", type: "text", format: "iso-language" },
  { key: "italianLevel", type: "enum" },
  { key: "additionalLanguages", type: "list" },
  { key: "transport", type: "text" },
  { key: "drivingLicense", type: "bool" },
  { key: "drivingLicenseTypes", type: "list" },
  { key: "workingPermit", type: "bool" },
  { key: "educationAndTraining", type: "list" },
  { key: "workExperience", type: "list" },
  { key: "skillsAndCompetences", type: "list" },
  { key: "jobPreferences.preferredJob", type: "text" },
  { key: "jobPreferences.preferredLocation", type: "text" },
  { key: "jobPreferences.constraints", type: "text" },
  { key: "jobPreferences.partTime", type: "bool" },
  { key: "jobPreferences.hasDesiredJobExperience", type: "text" },
  { key: "learningPreferences.isInterested", type: "bool" },
  { key: "learningPreferences.preference", type: "text" },
];

describe("standard fields match spec §6", () => {
  it("has exactly the spec's keys", () => {
    expect(STANDARD_FIELD_DEFINITIONS.map((f) => f.key).sort()).toEqual(
      SPEC.map((f) => f.key).sort(),
    );
  });

  it.each(SPEC)("$key", (expected) => {
    const def = getStandardField(expected.key);
    expect(def?.type).toBe(expected.type);
    expect(def?.format).toBe(expected.format);
    expect(def?.systemOnly === true).toBe(expected.systemOnly === true);
  });

  it("italianLevel offers the spec's levels", () => {
    expect(getStandardField("italianLevel")?.options).toEqual([...ITALIAN_LEVELS]);
    expect(ITALIAN_LEVELS).toEqual(["nessuno", "base", "intermedio", "avanzato", "madrelingua"]);
  });
});
