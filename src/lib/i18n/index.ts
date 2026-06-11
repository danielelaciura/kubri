import { it } from "./dictionaries/it";
import { en } from "./dictionaries/en";
import type { Dictionary, Locale } from "./types";

export type { Dictionary, Locale };

export const LOCALES = ["it", "en"] as const;
export const DEFAULT_LOCALE: Locale = "it";

const DICTIONARIES: Record<Locale, Dictionary> = { it, en };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
