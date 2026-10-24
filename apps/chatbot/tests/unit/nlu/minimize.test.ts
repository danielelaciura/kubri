import { describe, expect, it } from "vitest";
import type { ProfileSnapshot } from "../../../src/engine/profile-snapshot";
import type { PendingConfirmation } from "../../../src/engine/state";
import type { CustomFieldDefinition } from "../../../src/profile/custom-fields";
import { isWithheldField, scrubHistory, WITHHELD_FIELDS } from "../../../src/nlu/minimize";
import { inferred } from "../engine/helpers";

const CUSTOM: CustomFieldDefinition[] = [
  {
    key: "disability",
    type: "text",
    label: { it: "Invalidità" },
    description: "Invalidità civile dichiarata.",
    sensitive: true,
  },
  { key: "night_shifts", type: "bool", label: { it: "Notte" }, description: "Turni di notte." },
];

const PROFILE: ProfileSnapshot = {
  firstName: inferred("Mariangela"),
  lastName: inferred("Bertolucci"),
  birthday: inferred("1990-05-02"),
  address: inferred("Via Garibaldi 12"),
  email: inferred("mb@example.com"),
  transport: inferred("bicicletta"),
  location: inferred("Bo"),
};

const scrub = (
  history: string[],
  profile: ProfileSnapshot,
  pending: PendingConfirmation | null = null,
): string[] => scrubHistory(history, { profile, pending, customFields: CUSTOM });

describe("WITHHELD_FIELDS", () => {
  it("lists the personal data of spec §8.2", () => {
    expect([...WITHHELD_FIELDS].sort()).toEqual(
      ["address", "birthday", "email", "firstName", "lastName", "lat", "lng", "phone"].sort(),
    );
  });
});

describe("isWithheldField", () => {
  it("covers personal data and sensitive fields, standard or custom", () => {
    expect(isWithheldField("firstName", CUSTOM)).toBe(true);
    expect(isWithheldField("workingPermit", CUSTOM)).toBe(true);
    expect(isWithheldField("jobPreferences.constraints", CUSTOM)).toBe(true);
    expect(isWithheldField("custom.disability", CUSTOM)).toBe(true);
    expect(isWithheldField("custom.night_shifts", CUSTOM)).toBe(false);
    expect(isWithheldField("transport", CUSTOM)).toBe(false);
  });
});

describe("scrubHistory", () => {
  it("replaces collected personal data with the field name, ignoring case", () => {
    expect(
      scrub(
        ["mi chiamo MARIANGELA bertolucci", "abito in via garibaldi 12, scrivi a mb@example.com"],
        PROFILE,
      ),
    ).toEqual(["mi chiamo [firstName] [lastName]", "abito in [address], scrivi a [email]"]);
  });

  it("recognizes the birth date written the Italian way", () => {
    expect(scrub(["sono nata il 02/05/1990", "cioè il 2/5/1990"], PROFILE)).toEqual([
      "sono nata il [birthday]",
      "cioè il [birthday]",
    ]);
  });

  it("keeps the values of other fields", () => {
    expect(scrub(["vado in bicicletta a Bo"], PROFILE)).toEqual(["vado in bicicletta a Bo"]);
  });

  it("scrubs the values of sensitive fields, standard or custom", () => {
    expect(
      scrub(["ho un'invalidità al 40%, e devo accudire mia madre"], {
        "custom.disability": inferred("invalidità al 40%"),
        "jobPreferences.constraints": inferred("devo accudire mia madre"),
      }),
    ).toEqual(["ho un'[custom.disability], e [jobPreferences.constraints]"]);
  });

  it("matches whole words only, so other words keep their meaning", () => {
    expect(scrub(["Ada, sono adatta"], { firstName: inferred("Ada") })).toEqual([
      "[firstName], sono adatta",
    ]);
  });

  it("treats regular-expression characters in values literally", () => {
    const profile: ProfileSnapshot = { email: inferred("a.b+c@example.com") };

    expect(scrub(["a.b+c@example.com e aXb+c@example.com"], profile)).toEqual([
      "[email] e aXb+c@example.com",
    ]);
  });

  it("also scrubs the personal values of a pending confirmation, not yet saved", () => {
    expect(
      scrub(
        ["mi chiamo Mrio"],
        {},
        {
          kind: "value",
          field: "firstName",
          value: "Mrio",
          confidence: 0.5,
        },
      ),
    ).toEqual(["mi chiamo [firstName]"]);
    expect(
      scrub(
        ["era Rossi, è Rossini"],
        {},
        {
          kind: "edit",
          field: "lastName",
          oldValue: "Rossi",
          newValue: "Rossini",
        },
      ),
    ).toEqual(["era [lastName], è [lastName]"]);
  });

  it("keeps the pending value of a field that is not personal", () => {
    expect(
      scrub(
        ["vado in bici"],
        {},
        {
          kind: "value",
          field: "transport",
          value: "bici",
          confidence: 0.5,
        },
      ),
    ).toEqual(["vado in bici"]);
    expect(scrub(["vado in bici"], {}, { kind: "delete_data" })).toEqual(["vado in bici"]);
  });
});
