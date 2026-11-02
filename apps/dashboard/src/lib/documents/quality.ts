/** Below this many non-whitespace characters there is no CV worth an LLM call. */
export const MIN_CV_TEXT_CHARS = 300;

const CV_SIGNALS: readonly RegExp[] = [
  /\+?\d[\d\s./-]{7,}\d/, // phone-like
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, // email
  /\b(?:19|20)\d{2}\b/, // a year
  /\b(?:esperienz|lavor|formazion|competenz|istruzion|curricul|experience|education|skills|employment|expérience|formation|compétences|experiencia|formación|educación|habilidades)/i,
];

/**
 * Free check run before the paid LLM step on public uploads: enough text and
 * at least one thing a CV usually has. Deliberately permissive — it only has
 * to stop junk (blank scans, random files), the LLM's isCv does the rest.
 */
export function passesCvQualityGate(text: string): boolean {
  if (text.replace(/\s+/g, "").length < MIN_CV_TEXT_CHARS) return false;
  return CV_SIGNALS.some((re) => re.test(text));
}
