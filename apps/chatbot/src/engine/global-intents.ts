import type { Interpretation } from "./interpretation";
import { normalizeText } from "./normalize-text";

export type GlobalIntent = "opt_out" | "delete_data";

// Whole-message phrases, normalized on load so accents and tashkeel never matter (D40). Short on purpose: a false positive stops
// an interview, a false negative still reaches the LLM.
const PHRASE_LIST: readonly (readonly [string, GlobalIntent])[] = [
  ["stop", "opt_out"],
  ["basta", "opt_out"],
  ["stop bot", "opt_out"],
  ["unsubscribe", "opt_out"],
  ["arret", "opt_out"],
  ["توقف", "opt_out"],
  ["стоп", "opt_out"],
  ["بند", "opt_out"],
  ["বন্ধ", "opt_out"],
  ["opreste", "opt_out"],
  ["parar", "opt_out"],
  ["no mas", "opt_out"],
  ["cancella i miei dati", "delete_data"],
  ["elimina i miei dati", "delete_data"],
  ["cancellami", "delete_data"],
  ["delete my data", "delete_data"],
  ["supprimer mes donnees", "delete_data"],
  ["borrar mis datos", "delete_data"],
  ["sterge datele mele", "delete_data"],
  ["احذف بياناتي", "delete_data"],
];
const PHRASES: ReadonlyMap<string, GlobalIntent> = new Map(
  PHRASE_LIST.map(([phrase, intent]) => [normalizeText(phrase), intent]),
);

/** Deterministic: works without the LLM (spec §7.2 point 1). */
export function detectGlobalIntent(text: string): GlobalIntent | undefined {
  return PHRASES.get(normalizeText(text));
}

/** The keyword wins; otherwise the LLM's intent, if it is a global one. */
export function globalIntentOf(
  text: string,
  interpretation: Interpretation | null,
): GlobalIntent | undefined {
  const keyword = detectGlobalIntent(text);
  if (keyword) return keyword;
  const intent = interpretation?.intent;
  return intent === "opt_out" || intent === "delete_data" ? intent : undefined;
}

// Whole-message "yes" to a pending deletion, for when the LLM is unavailable. Short on purpose:
// a false negative only cancels the deletion, which the candidate can ask for again.
const YES_PHRASES: ReadonlySet<string> = new Set(
  ["si", "yes", "ok", "confermo", "oui", "sim", "da", "نعم", "да"].map(normalizeText),
);

/** Deterministic yes, used to confirm a data deletion without the LLM. */
export function isYesKeyword(text: string): boolean {
  return YES_PHRASES.has(normalizeText(text));
}
