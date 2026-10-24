import { describe, expect, it } from "vitest";
import type { ProfileSnapshot } from "../../../src/engine/profile-snapshot";
import { scrubHistory, WITHHELD_FIELDS } from "../../../src/nlu/minimize";
import { inferred } from "../engine/helpers";

const PROFILE: ProfileSnapshot = {
  firstName: inferred("Mariangela"),
  lastName: inferred("Bertolucci"),
  birthday: inferred("1990-05-02"),
  address: inferred("Via Garibaldi 12"),
  email: inferred("mb@example.com"),
  transport: inferred("bicicletta"),
  location: inferred("Bo"),
};

describe("WITHHELD_FIELDS", () => {
  it("lists the personal data of spec §8.2", () => {
    expect([...WITHHELD_FIELDS].sort()).toEqual(
      ["address", "birthday", "email", "firstName", "lastName", "lat", "lng", "phone"].sort(),
    );
  });
});

describe("scrubHistory", () => {
  it("replaces collected personal data with the field name, ignoring case", () => {
    expect(
      scrubHistory(
        ["mi chiamo MARIANGELA bertolucci", "abito in via garibaldi 12, scrivi a mb@example.com"],
        PROFILE,
      ),
    ).toEqual(["mi chiamo [firstName] [lastName]", "abito in [address], scrivi a [email]"]);
  });

  it("recognizes the birth date written the Italian way", () => {
    expect(scrubHistory(["sono nata il 02/05/1990", "cioè il 2/5/1990"], PROFILE)).toEqual([
      "sono nata il [birthday]",
      "cioè il [birthday]",
    ]);
  });

  it("keeps the values of other fields", () => {
    expect(scrubHistory(["vado in bicicletta a Bo"], PROFILE)).toEqual(["vado in bicicletta a Bo"]);
  });

  it("keeps personal values too short to be matched safely", () => {
    expect(scrubHistory(["Li Wei, vivo a Linate"], { lastName: inferred("Li") })).toEqual([
      "Li Wei, vivo a Linate",
    ]);
  });

  it("matches whole words only, so other words keep their meaning", () => {
    expect(scrubHistory(["Ada, sono adatta"], { firstName: inferred("Ada") })).toEqual([
      "[firstName], sono adatta",
    ]);
  });

  it("treats regular-expression characters in values literally", () => {
    const profile: ProfileSnapshot = { email: inferred("a.b+c@example.com") };

    expect(scrubHistory(["a.b+c@example.com e aXb+c@example.com"], profile)).toEqual([
      "[email] e aXb+c@example.com",
    ]);
  });

  it("also scrubs the personal values of a pending confirmation, not yet saved", () => {
    expect(
      scrubHistory(
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
      scrubHistory(
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
      scrubHistory(
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
    expect(scrubHistory(["vado in bici"], {}, { kind: "delete_data" })).toEqual(["vado in bici"]);
  });
});
