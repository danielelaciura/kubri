import type { LanguageCode } from "../i18n/localized-text";
import type { Interpretation } from "./interpretation";
import { normalizeText } from "./normalize-text";

const LANGUAGE_NAME_LIST: readonly (readonly [string, LanguageCode])[] = [
  ["italiano", "it"],
  ["italian", "it"],
  ["italien", "it"],
  ["inglese", "en"],
  ["english", "en"],
  ["anglais", "en"],
  ["ingles", "en"],
  ["francese", "fr"],
  ["french", "fr"],
  ["français", "fr"],
  ["spagnolo", "es"],
  ["spanish", "es"],
  ["español", "es"],
  ["espagnol", "es"],
  ["arabo", "ar"],
  ["arabic", "ar"],
  ["arabe", "ar"],
  ["العربية", "ar"],
  ["عربي", "ar"],
  ["ucraino", "uk"],
  ["ukrainian", "uk"],
  ["ukrainien", "uk"],
  ["ucraniano", "uk"],
  ["українська", "uk"],
  ["russo", "ru"],
  ["russian", "ru"],
  ["russe", "ru"],
  ["русский", "ru"],
  ["rumeno", "ro"],
  ["romeno", "ro"],
  ["romena", "ro"],
  ["rumena", "ro"],
  ["romanian", "ro"],
  ["roumain", "ro"],
  ["rumano", "ro"],
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
  ["tedesco", "de"],
  ["german", "de"],
  ["deutsch", "de"],
  ["cinese", "zh"],
  ["chinese", "zh"],
  ["chinois", "zh"],
  ["中文", "zh"],
  ["hindi", "hi"],
  ["punjabi", "pa"],
  ["panjabi", "pa"],
  ["tagalog", "tl"],
  ["turco", "tr"],
  ["turkish", "tr"],
  ["persiano", "fa"],
  ["farsi", "fa"],
  ["polacco", "pl"],
  ["polish", "pl"],
  ["bulgaro", "bg"],
  ["tigrino", "ti"],
  ["amarico", "am"],
  ["somalo", "so"],
  ["pashto", "ps"],
];

/** Language names in Italian, English, French, Spanish and the language itself. Keys are
 * normalized on load, so accent twins are not needed. */
const LANGUAGE_NAMES: ReadonlyMap<string, LanguageCode> = new Map(
  LANGUAGE_NAME_LIST.map(([name, code]) => [normalizeText(name), code]),
);

/** Longer messages are sentences, not a language choice ("non parlo italiano, ma..."). */
const MAX_NAME_TOKENS = 3;

/** Below this the LLM's language detection is ignored (D41). */
export const LANGUAGE_CONFIDENCE_THRESHOLD = 0.8;

/** "Arabo" → "ar": the first word that names a language, in a message of at most 3 words. */
export function detectLanguageName(text: string): LanguageCode | undefined {
  const words = normalizeText(text).split(" ");
  if (words.length > MAX_NAME_TOKENS) return undefined;
  for (const word of words) {
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
