import { DEFAULT_LANGUAGE, type LanguageCode, type LocalizedText } from "./localized-text";
import { samePlaceholders } from "./template";
import { sourceHash, type CachedTranslation, type TranslationCache } from "./translation-cache";
import type { Translation, TranslationKind, Translator } from "./translator";

export type TemplateSource = "reference" | "curated" | "cache" | "translated" | "fallback";

export interface ResolvedTemplate {
  readonly template: string;
  /** The language the template is actually in: Italian after a fallback (D72). */
  readonly language: LanguageCode;
  readonly source: TemplateSource;
  /** Reviewed by a person (D73). */
  readonly isCurated: boolean;
}

export interface TemplateServices {
  readonly translator: Translator;
  readonly cache: TranslationCache;
}

/** Spec §9: curated translation → cache → translator; Italian when all else fails (D72). */
export async function resolveTemplate(
  text: LocalizedText,
  language: LanguageCode,
  kind: TranslationKind,
  services: TemplateServices,
): Promise<ResolvedTemplate> {
  const italian = text[DEFAULT_LANGUAGE];
  if (italian === undefined) throw new Error("a localized text without Italian");
  if (language === DEFAULT_LANGUAGE) {
    return { template: italian, language, source: "reference", isCurated: true };
  }
  const curated = text[language];
  if (curated !== undefined) {
    return { template: curated, language, source: "curated", isCurated: true };
  }
  const hash = sourceHash(italian);
  const cached = await readCache(services.cache, hash, language);
  if (cached) {
    return { template: cached.text, language, source: "cache", isCurated: cached.reviewed };
  }
  const fallback: ResolvedTemplate = {
    template: italian,
    language: DEFAULT_LANGUAGE,
    source: "fallback",
    isCurated: true,
  };
  let translation: Translation;
  try {
    translation = await services.translator.translate({
      text: italian,
      sourceLanguage: DEFAULT_LANGUAGE,
      targetLanguage: language,
      kind,
    });
  } catch {
    return fallback;
  }
  if (translation.text.trim() === "" || !samePlaceholders(italian, translation.text)) {
    return fallback;
  }
  await writeCache(services.cache, hash, language, {
    text: translation.text,
    reviewed: false,
    provider: translation.provider,
    model: translation.model,
  });
  return { template: translation.text, language, source: "translated", isCurated: false };
}

// A cache failure never blocks a reply (D72): the store logs its own errors (plan 08).
async function readCache(
  cache: TranslationCache,
  hash: string,
  language: LanguageCode,
): Promise<CachedTranslation | undefined> {
  try {
    return await cache.get(hash, language);
  } catch {
    return undefined;
  }
}

async function writeCache(
  cache: TranslationCache,
  hash: string,
  language: LanguageCode,
  entry: CachedTranslation,
): Promise<void> {
  try {
    await cache.set(hash, language, entry);
  } catch {
    // Same as readCache: the translation is still sent.
  }
}
