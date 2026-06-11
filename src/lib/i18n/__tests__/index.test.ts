import { describe, it as test, expect } from "vitest";
import { getDictionary, isLocale, DEFAULT_LOCALE, LOCALES } from "../index";
import { it } from "../dictionaries/it";
import { en } from "../dictionaries/en";

describe("i18n index", () => {
  test("getDictionary returns the matching dictionary", () => {
    expect(getDictionary("it")).toBe(it);
    expect(getDictionary("en")).toBe(en);
  });

  test("getDictionary falls back to default for unknown locale", () => {
    // @ts-expect-error testing runtime fallback
    expect(getDictionary("fr")).toBe(getDictionary(DEFAULT_LOCALE));
  });

  test("isLocale validates supported locales", () => {
    expect(isLocale("it")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  test("it and en have identical key sets (deep)", () => {
    const keysOf = (obj: object): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === "object"
          ? Object.keys(v).map((sub) => `${k}.${sub}`)
          : [k],
      );
    expect(keysOf(en).sort()).toEqual(keysOf(it).sort());
  });

  test("LOCALES contains it and en", () => {
    expect([...LOCALES]).toEqual(["it", "en"]);
  });
});
