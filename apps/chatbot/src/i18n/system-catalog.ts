import type { SystemTextKey, TextParams } from "../engine/text-ref";
import type { LocalizedText } from "./localized-text";

/** How a parameter is shown (D75). `flag` only selects a variant and is never interpolated. */
export type ParamKind = "text" | "number" | "field" | "value" | "flag";

export interface CatalogEntry {
  readonly params: Readonly<Record<string, ParamKind>>;
  /** Italian first (CLAUDE.md); a function picks a variant from the `flag` parameters. */
  readonly text: LocalizedText | ((params: TextParams) => LocalizedText);
}

/** Texts owned by i18n itself: value formats and the lines it adds around engine texts. */
export const I18N_TEXT_KEYS = [
  "format.yes",
  "format.no",
  "format.empty",
  "send.clarify",
  "send.rephrase",
  "consent.official_link",
] as const;
export type I18nTextKey = (typeof I18N_TEXT_KEYS)[number];
export type CatalogKey = SystemTextKey | I18nTextKey;

const POST_COMPLETION = {
  both: {
    it: 'La tua intervista è completa. Se vuoi, puoi correggere un dato (per esempio: "il mio comune è Bologna") oppure chiedermi di rifare il CV.',
  },
  edits: {
    it: 'La tua intervista è completa. Se vuoi, puoi correggere un dato scrivendomelo (per esempio: "il mio comune è Bologna").',
  },
  cv: { it: "La tua intervista è completa. Se vuoi, puoi chiedermi di rifare il CV." },
  none: {
    it: "La tua intervista è completa. Grazie! Se c'è un'opportunità adatta a te, potranno contattarti.",
  },
} as const satisfies Record<string, LocalizedText>;

function postCompletionHelp(params: TextParams): LocalizedText {
  const edits = params["allowEdits"] === true;
  const cv = params["allowCvRegeneration"] === true;
  if (edits && cv) return POST_COMPLETION.both;
  if (edits) return POST_COMPLETION.edits;
  if (cv) return POST_COMPLETION.cv;
  return POST_COMPLETION.none;
}

// User-facing system texts live here, never in the engine (CLAUDE.md, code conventions).
export const SYSTEM_CATALOG: Readonly<Record<CatalogKey, CatalogEntry>> = {
  "system.welcome": {
    params: {},
    text: {
      it: "Ciao! Sono l'assistente di Kubri 👋 In che lingua vuoi continuare? Scrivi il nome della lingua, per esempio: italiano, English, français, العربية.\nHi! I'm Kubri's assistant. Which language would you like to continue in? Just write its name, for example: English.",
    },
  },
  "system.not_understood": {
    params: {},
    text: { it: "Scusa, non ho capito bene. Puoi scriverlo in un altro modo?" },
  },
  "system.generic_error": {
    params: {},
    text: {
      it: "Scusa, c'è stato un problema da parte mia. Riprova tra qualche minuto, per favore.",
    },
  },
  "system.help": {
    params: {},
    text: {
      it: 'Ti faccio alcune domande per conoscerti e aiutarti a trovare un lavoro adatto a te. Puoi rispondere come preferisci, anche con frasi brevi. Se vuoi fermarti scrivi "stop"; se vuoi cancellare i tuoi dati scrivi "cancella i miei dati".',
    },
  },
  "system.off_topic": {
    params: {},
    text: { it: "Su questo non posso aiutarti: mi occupo solo di questa intervista." },
  },
  "system.progress": {
    params: { current: "number", total: "number" },
    text: { it: "Sezione {current} di {total}" },
  },
  "system.confirm_value": {
    params: { field: "field", value: "value" },
    text: { it: "Per «{field}» ho capito:\n{value}\nÈ corretto? Rispondi sì o no." },
  },
  "system.confirm_edit": {
    params: { field: "field", oldValue: "value", newValue: "value" },
    text: {
      it: "Vuoi cambiare «{field}» da {oldValue} a {newValue}? Rispondi sì per confermare o no per lasciarlo com'è.",
    },
  },
  "system.edit_saved": { params: {}, text: { it: "Fatto, ho aggiornato il dato." } },
  "system.edit_cancelled": { params: {}, text: { it: "Va bene, lascio tutto com'è." } },
  "system.edit_invalid": {
    params: {},
    text: {
      it: 'Non ho capito quale dato vuoi cambiare o con quale valore. Puoi riscriverlo? Per esempio: "il mio comune è Bologna".',
    },
  },
  "system.edit_not_allowed": {
    params: {},
    text: { it: "Mi dispiace, per questa candidatura non posso più modificare i dati." },
  },
  "system.post_completion_help": {
    params: { allowEdits: "flag", allowCvRegeneration: "flag" },
    text: postCompletionHelp,
  },
  "system.cv_requested": {
    params: {},
    text: { it: "Perfetto, preparo il tuo CV. Te lo mando appena è pronto." },
  },
  "system.opt_out_confirm": {
    params: {},
    text: {
      it: "Va bene, mi fermo qui e non ti scriverò più. Grazie per il tuo tempo.",
    },
  },
  "system.delete_confirm": {
    params: {},
    text: {
      it: "Vuoi cancellare tutti i tuoi dati? Rispondi sì per cancellare. Con qualsiasi altra risposta non cancello nulla.",
    },
  },
  "system.delete_done": {
    params: {},
    text: { it: "Fatto: cancelliamo tutti i tuoi dati. Grazie e buona fortuna!" },
  },
  "system.delete_cancelled": { params: {}, text: { it: "Va bene, non cancello nulla." } },
  "system.stopped": {
    params: {},
    text: { it: "Va bene, l'intervista finisce qui. Grazie per il tuo tempo." },
  },
  "system.closing": {
    params: {},
    text: {
      it: "Grazie! L'intervista è completa. Se c'è un'opportunità adatta a te, potranno contattarti.",
    },
  },
  "system.session_closed": {
    params: {},
    text: { it: "Questa conversazione è chiusa. Grazie per averci scritto!" },
  },
  "format.yes": { params: {}, text: { it: "sì" } },
  "format.no": { params: {}, text: { it: "no" } },
  "format.empty": { params: {}, text: { it: "(nessun valore)" } },
  "send.clarify": {
    params: { missing: "text" },
    text: { it: "Mi serve ancora un dettaglio: {missing}" },
  },
  "send.rephrase": {
    params: {},
    text: { it: "Provo a spiegarmi meglio:" },
  },
  "consent.official_link": {
    params: { link: "text" },
    text: {
      it: "Questa è una traduzione automatica. Il testo ufficiale, in italiano, è qui: {link}",
    },
  },
};

/** The entry's text for these parameters (its variant, for flag-driven entries). */
export function catalogText(entry: CatalogEntry, params: TextParams): LocalizedText {
  return typeof entry.text === "function" ? entry.text(params) : entry.text;
}
