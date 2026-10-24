import { describe, expect, it } from "vitest";
import { interpolate, placeholdersOf, samePlaceholders } from "../../../src/i18n/template";

describe("placeholdersOf", () => {
  it("lists distinct names, sorted, dotted names included", () => {
    expect(placeholdersOf("{b} {a} {dataController.name} {a}")).toEqual([
      "a",
      "b",
      "dataController.name",
    ]);
  });

  it("ignores braces that are not placeholders", () => {
    expect(placeholdersOf("{} { a } {1x} {{ }}")).toEqual([]);
  });
});

describe("samePlaceholders", () => {
  it("compares the sets of names, not their order or count", () => {
    expect(samePlaceholders("{a} e {b}", "{b}, {a}, {a}")).toBe(true);
    expect(samePlaceholders("{a} e {b}", "{a}")).toBe(false);
    expect(samePlaceholders("{a}", "{a} {c}")).toBe(false);
  });
});

describe("interpolate", () => {
  it("replaces every occurrence", () => {
    expect(interpolate("{a}-{a} {b}", { a: "x", b: "y" })).toEqual({ text: "x-x y", missing: [] });
  });

  it("keeps unknown placeholders visible and reports them", () => {
    expect(interpolate("Ciao {name}, {name}!", {})).toEqual({
      text: "Ciao {name}, {name}!",
      missing: ["name"],
    });
  });

  it("never reads inserted values again", () => {
    expect(interpolate("{value}", { value: "{value} {other}" })).toEqual({
      text: "{value} {other}",
      missing: [],
    });
  });
});
