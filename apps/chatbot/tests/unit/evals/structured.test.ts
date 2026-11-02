import { describe, expect, it } from "vitest";
import { entriesMatch, parseEntry, structuredListsMatch } from "../../../src/evals/structured";

describe("parseEntry", () => {
  it("splits years, place, country and role", () => {
    expect(parseEntry("2018 - 2020 Magazzino Rossi (Italia): Magazziniere")).toEqual({
      from: "2018",
      to: "2020",
      place: "Magazzino Rossi",
      country: "Italia",
      role: "Magazziniere",
    });
  });

  it("accepts a single year, no country, and an open end", () => {
    expect(parseEntry("2021 Bologna: Cuoco")).toMatchObject({
      from: "2021",
      to: null,
      country: null,
    });
    expect(parseEntry("2019 - oggi Modena: Cameriere")).toMatchObject({ to: "oggi" });
  });

  it("refuses text that is not an entry", () => {
    expect(parseEntry("ho fatto il cuoco")).toBeNull();
  });
});

describe("entriesMatch", () => {
  const expected = "2018 - 2020 Bologna (Italia): Magazziniere";

  it("ignores case, accents and the country when one side has none", () => {
    expect(entriesMatch(expected, "2018 - 2020 bologna: magazziniere")).toBe(true);
  });

  it("treats 'oggi' and 'presente' as the same open end", () => {
    expect(entriesMatch("2019 - oggi Modena: Cuoco", "2019 - presente Modena: Cuoco")).toBe(true);
  });

  it.each([
    "2017 - 2020 Bologna: Magazziniere",
    "2018 - 2021 Bologna: Magazziniere",
    "2018 - 2020 Modena: Magazziniere",
    "2018 - 2020 Bologna: Cuoco",
    "2018 - 2020 Bologna (Francia): Magazziniere",
    "magazziniere a Bologna",
  ])("rejects %j", (actual) => {
    expect(entriesMatch(expected, actual)).toBe(false);
  });

  it("falls back to normalized text when the expected entry has no structure", () => {
    expect(entriesMatch("Patente B", "patente b")).toBe(true);
    expect(entriesMatch("Patente B", "patente C")).toBe(false);
  });
});

describe("structuredListsMatch", () => {
  it("matches one to one, in any order", () => {
    expect(
      structuredListsMatch(
        ["2018 - 2020 Bologna: Cuoco", "2021 Modena: Cameriere"],
        ["2021 Modena: cameriere", "2018 - 2020 Bologna: cuoco"],
      ),
    ).toBe(true);
  });

  it("needs the same number of entries", () => {
    expect(structuredListsMatch(["2018 Bologna: Cuoco"], [])).toBe(false);
    expect(
      structuredListsMatch(["2018 Bologna: Cuoco"], ["2018 Bologna: Cuoco", "2019 Bologna: Cuoco"]),
    ).toBe(false);
  });
});
