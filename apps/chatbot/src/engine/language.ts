import type { LanguageCode } from "../i18n/localized-text";
import type { Interpretation } from "./interpretation";
import { normalizeText } from "./normalize-text";

/** Language names in Italian, English, French and the language itself, normalized. */
const LANGUAGE_NAMES: ReadonlyMap<string, LanguageCode> = new Map([
  ["italiano", "it"],
  ["italian", "it"],
  ["italien", "it"],
  ["inglese", "en"],
  ["english", "en"],
  ["anglais", "en"],
  ["francese", "fr"],
  ["french", "fr"],
  ["français", "fr"],
  ["francais", "fr"],
  ["spagnolo", "es"],
  ["spanish", "es"],
  ["español", "es"],
  ["espanol", "es"],
  ["arabo", "ar"],
  ["arabic", "ar"],
  ["arabe", "ar"],
  ["العربية", "ar"],
  ["عربي", "ar"],
  ["ucraino", "uk"],
  ["ukrainian", "uk"],
  ["українська", "uk"],
  ["russo", "ru"],
  ["russian", "ru"],
  ["русский", "ru"],
  ["rumeno", "ro"],
  ["romeno", "ro"],
  ["romanian", "ro"],
  ["română", "ro"],
  ["romana", "ro"],
  ["albanese", "sq"],
  ["albanian", "sq"],
  ["shqip", "sq"],
  ["bengalese", "bn"],
  ["bengali", "bn"],
  ["বাংলা", "bn"],
  ["urdu", "ur"],
  ["اردو", "ur"],
  ["portoghese", "pt"],
  ["portuguese", "pt"],
  ["português", "pt"],
  ["portugues", "pt"],
  ["tedesco", "de"],
  ["german", "de"],
  ["deutsch", "de"],
  ["cinese", "zh"],
  ["chinese", "zh"],
  ["中文", "zh"],
]);

/** Below this the LLM's language detection is ignored (D41). */
export const LANGUAGE_CONFIDENCE_THRESHOLD = 0.8;

/** "Arabo" → "ar": the first word of the message that names a language. */
export function detectLanguageName(text: string): LanguageCode | undefined {
  for (const word of normalizeText(text).split(" ")) {
    const code = LANGUAGE_NAMES.get(word);
    if (code) return code;
  }
  return undefined;
}

/** Spec §5.6 point 2, deterministic part: name → confident detection → campaign default. */
export function chooseLanguage(
  text: string,
  interpretation: Interpretation | null,
  fallback: LanguageCode,
): LanguageCode {
  const named = detectLanguageName(text);
  if (named) return named;
  if (interpretation && interpretation.language.confidence >= LANGUAGE_CONFIDENCE_THRESHOLD) {
    return interpretation.language.code;
  }
  return fallback;
}
