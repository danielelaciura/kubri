import { describe, expect, it } from "vitest";
import {
  EMPTY_PROFILE,
  parseStoredProfile,
  setStoredField,
  toSnapshot,
  type StoredProfile,
} from "../../../src/runtime/profile-codec";

const META = { confidence: 0.9, status: "inferred", source: "extraction" } as const;

describe("setStoredField", () => {
  it("puts standard and custom fields in their own bucket, immutably", () => {
    const first = setStoredField(EMPTY_PROFILE, "firstName", "Mario", META);
    const second = setStoredField(first, "custom.night_shifts", true, META);

    expect(EMPTY_PROFILE.standard).toEqual({});
    expect(second.standard).toEqual({ firstName: "Mario" });
    expect(second.custom).toEqual({ night_shifts: true });
    expect(second.fieldMeta["custom.night_shifts"]).toEqual(META);
  });

  it("keeps dotted standard keys whole", () => {
    const next = setStoredField(EMPTY_PROFILE, "jobPreferences.partTime", false, META);

    expect(next.standard).toEqual({ "jobPreferences.partTime": false });
  });

  it("drops the value of an unresolved field", () => {
    const filled = setStoredField(EMPTY_PROFILE, "email", "a@b.it", META);

    const next = setStoredField(filled, "email", null, {
      confidence: 0,
      status: "unresolved",
      source: "system",
    });

    expect(next.standard).toEqual({});
    expect(next.fieldMeta["email"]?.status).toBe("unresolved");
  });
});

describe("toSnapshot", () => {
  it("rebuilds the engine's flat snapshot, with null for unresolved fields", () => {
    let stored: StoredProfile = setStoredField(EMPTY_PROFILE, "firstName", "Mario", META);
    stored = setStoredField(stored, "custom.night_shifts", true, META);
    stored = setStoredField(stored, "email", null, {
      confidence: 0,
      status: "unresolved",
      source: "system",
    });

    expect(toSnapshot(stored)).toEqual({
      firstName: { value: "Mario", confidence: 0.9, status: "inferred" },
      "custom.night_shifts": { value: true, confidence: 0.9, status: "inferred" },
      email: { value: null, confidence: 0, status: "unresolved" },
    });
  });
});

describe("parseStoredProfile", () => {
  it("reads the three JSON columns", () => {
    const parsed = parseStoredProfile({
      standard: { firstName: "Mario" },
      custom: {},
      fieldMeta: { firstName: META },
    });

    expect(parsed.standard).toEqual({ firstName: "Mario" });
  });

  it("refuses a corrupt column", () => {
    expect(() => parseStoredProfile({ standard: [], custom: {}, fieldMeta: {} })).toThrow(
      /stored profile/,
    );
    expect(() =>
      parseStoredProfile({ standard: {}, custom: {}, fieldMeta: { x: { confidence: 2 } } }),
    ).toThrow(/stored profile/);
  });
});
