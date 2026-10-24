import type { Interpretation } from "./interpretation";
import { normalizeText } from "./normalize-text";

export type GlobalIntent = "opt_out" | "delete_data";

// Whole-message phrases, already normalized (D40). Short on purpose: a false positive stops
// an interview, a false negative still reaches the LLM.
const PHRASES: ReadonlyMap<string, GlobalIntent> = new Map([
  ["stop", "opt_out"],
  ["basta", "opt_out"],
  ["stop bot", "opt_out"],
  ["unsubscribe", "opt_out"],
  ["arrêt", "opt_out"],
  ["arret", "opt_out"],
  ["توقف", "opt_out"],
  ["cancella i miei dati", "delete_data"],
  ["elimina i miei dati", "delete_data"],
  ["cancellami", "delete_data"],
  ["delete my data", "delete_data"],
  ["supprimer mes données", "delete_data"],
  ["احذف بياناتي", "delete_data"],
]);

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
