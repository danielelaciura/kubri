import type { LanguageCode } from "./localized-text";

/** What a text is, so the translator can be stricter with consents (spec §9, D74). */
export type TranslationKind = "system" | "campaign" | "label" | "critical";

export interface TranslationRequest {
  /**
   * An Italian template: its `{placeholders}` must come back unchanged (D71). Never a
   * candidate's value: templates are translated before interpolation (D70).
   */
  readonly text: string;
  readonly sourceLanguage: LanguageCode;
  readonly targetLanguage: LanguageCode;
  readonly kind: TranslationKind;
}

export interface Translation {
  readonly text: string;
  /** Stored with the cached translation (spec §10.3). */
  readonly provider: string;
  readonly model: string;
}

/**
 * Translates Italian templates. nlu implements it with the LLM (plan 06). It throws when no
 * translation is available: i18n then falls back to Italian (D72).
 */
export interface Translator {
  translate(request: TranslationRequest): Promise<Translation>;
}
