import type { Locale } from "@/lib/i18n/types";

const ISO2 = /^[a-z]{2}$/i;

/**
 * Read-time display of a candidate's country of origin.
 *
 * The Make webhook now sends the 2-letter ISO 3166-1 alpha-2 code (e.g. "IT",
 * "ES") instead of a full country name. We do NOT rewrite the stored value —
 * the conversion happens only on read, localized to the user's locale.
 *
 * - If the value is a known ISO-2 code, it is resolved to the localized country
 *   name (e.g. "IT" → "Italia" in `it`, "Italy" in `en`).
 * - Otherwise the value is returned unchanged (passthrough), which keeps legacy
 *   rows that still store a full country name ("Italia", "Italy") working.
 * - `null`/empty input is preserved as `null` so callers keep their own fallback.
 */
export function displayCountry(
  value: string | null | undefined,
  locale: Locale,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!ISO2.test(trimmed)) return trimmed;

  try {
    // `fallback: "none"` makes Intl return `undefined` for unknown codes
    // instead of a localized "Unknown region" string, so we can passthrough.
    const display = new Intl.DisplayNames([locale], {
      type: "region",
      fallback: "none",
    });
    return display.of(trimmed.toUpperCase()) ?? trimmed;
  } catch {
    return trimmed;
  }
}
