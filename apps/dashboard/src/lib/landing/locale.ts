import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";

/**
 * Locale for the public landing, which has no user: Italian unless the visitor
 * picked another language with the switcher (`?lang=`). The browser language
 * is ignored on purpose: candidates often use phones set to English.
 */
export function resolvePublicLocale(lang: string | string[] | undefined): Locale {
  const requested = Array.isArray(lang) ? lang[0] : lang;
  return isLocale(requested) ? requested : DEFAULT_LOCALE;
}
