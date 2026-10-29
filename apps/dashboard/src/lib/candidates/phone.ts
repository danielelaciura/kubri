/**
 * Canonical digits-only phone for exact comparisons: strips separators and a
 * leading "00", and prefixes 39 to 10-digit numbers starting with 3 (Italian
 * mobiles written without country code). Null when fewer than 8 digits remain.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("3")) digits = `39${digits}`;
  return digits.length >= 8 ? digits : null;
}
