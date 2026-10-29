// Combining marks that are only decoration for lookup purposes: Latin/Cyrillic/Greek accents
// (U+0300-036F) and Arabic tashkeel (U+064B-065F, U+0670, U+06D6-06ED). The marks of Indic
// scripts (Bengali, Devanagari...) are part of the letters and are kept.
const DECORATIVE_MARKS = /[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06ed]/gu;
const TATWEEL = /\u0640/gu;

/**
 * For lookup: lowercase, NFKC, accents and Arabic vowel marks folded away, punctuation and
 * emoji replaced by spaces, single-spaced, trimmed ("Données" and "donnees" are the same).
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(DECORATIVE_MARKS, "")
    .replace(TATWEEL, "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
