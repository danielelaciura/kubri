import { describe, expect, it } from "vitest";
import {
  STANDARD_FIELD_DEFINITIONS as STANDARD_FIELDS,
  getStandardField,
} from "../../../src/profile/standard-fields";

describe("standard fields registry", () => {
  it("has unique keys", () => {
    const keys = STANDARD_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every field a description for the LLM", () => {
    for (const field of STANDARD_FIELDS) {
      expect(field.description.length, field.key).toBeGreaterThan(10);
    }
  });

  it("declares options for every enum field", () => {
    for (const field of STANDARD_FIELDS) {
      if (field.type === "enum") expect(field.options?.length, field.key).toBeGreaterThan(0);
    }
  });

  it("finds fields by key, including dotted keys", () => {
    expect(getStandardField("drivingLicense")?.type).toBe("bool");
    expect(getStandardField("jobPreferences.preferredJob")?.type).toBe("text");
  });

  it("returns undefined for unknown keys", () => {
    expect(getStandardField("favouriteColour")).toBeUndefined();
  });

  it("marks system fields that questions and the LLM must not write", () => {
    const systemOnly = STANDARD_FIELDS.filter((f) => f.systemOnly === true).map((f) => f.key);
    expect(systemOnly.sort()).toEqual(["lat", "lng", "phone"]);
  });
});
