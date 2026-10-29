import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

/**
 * Locale for the public landing, which has no user: `?lang=` wins, then an
 * English browser gets English, everyone else the default (Italian).
 */
export function resolvePublicLocale(
  lang: string | string[] | undefined,
  acceptLanguage: string | null,
): Locale {
  const requested = Array.isArray(lang) ? lang[0] : lang;
  if (isLocale(requested)) return requested;
  const first = acceptLanguage?.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return first === "en" ? "en" : DEFAULT_LOCALE;
}
