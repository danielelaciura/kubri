import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_THRESHOLD,
  fieldState,
  isFieldFilled,
  isFieldSettled,
  profileValues,
  sameValue,
  withField,
  type ProfileSnapshot,
} from "../../../src/engine/profile-snapshot";

const profile: ProfileSnapshot = {
  firstName: { value: "Mario", confidence: 0.9, status: "inferred" },
  lastName: { value: "Rossi", confidence: 0.4, status: "inferred" },
  drivingLicense: { value: false, confidence: 1, status: "confirmed" },
  workingPermit: { value: null, confidence: 0, status: "unresolved" },
};

describe("profile snapshot", () => {
  it("uses 0.7 as the confidence threshold (D34)", () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.7);
  });

  it("reads own fields only", () => {
    expect(fieldState(profile, "firstName")?.value).toBe("Mario");
    expect(fieldState(profile, "constructor")).toBeUndefined();
  });

  it.each([
    ["firstName", true],
    ["drivingLicense", true],
    ["lastName", false],
    ["workingPermit", false],
    ["email", false],
  ])("isFieldFilled(%s) = %s", (field, expected) => {
    expect(isFieldFilled(profile, field)).toBe(expected);
  });

  it("treats unresolved fields as settled: they are not asked again", () => {
    expect(isFieldSettled(profile, "workingPermit")).toBe(true);
    expect(isFieldSettled(profile, "lastName")).toBe(false);
  });

  it("exposes values to conditions, without unresolved fields", () => {
    expect(profileValues(profile)).toEqual({
      firstName: "Mario",
      lastName: "Rossi",
      drivingLicense: false,
    });
  });

  it("returns a new snapshot", () => {
    const next = withField(profile, "email", {
      value: "a@b.it",
      confidence: 0.9,
      status: "inferred",
    });
    expect(next.email?.value).toBe("a@b.it");
    expect(profile).not.toHaveProperty("email");
  });
});

describe("sameValue", () => {
  it.each([
    ["Mario", "Mario"],
    [true, true],
    [
      ["a", "b"],
      ["a", "b"],
    ],
    [
      { city: "Roma", lat: 1 },
      { lat: 1, city: "Roma" },
    ],
    [null, null],
  ])("equal: %j and %j", (a, b) => {
    expect(sameValue(a, b)).toBe(true);
  });

  it.each([
    ["Mario", "Marco"],
    [["a"], ["a", "b"]],
    [{ city: "Roma" }, { city: "Roma", lat: 1 }],
    [["a"], { 0: "a" }],
    [null, {}],
  ])("different: %j and %j", (a, b) => {
    expect(sameValue(a, b)).toBe(false);
  });
});
