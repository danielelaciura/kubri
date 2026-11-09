import { createHash } from "node:crypto";
import type { LanguageCode } from "./localized-text";

export interface CachedTranslation {
  readonly text: string;
  /** Checked by a person (spec §9): such a translation counts as curated (D73). */
  readonly reviewed: boolean;
  readonly provider: string;
  readonly model: string;
}

/** Spec §10.3, keyed by (sourceHash, language). The Prisma table comes with plan 08 (D78). */
export interface TranslationCache {
  get(sourceHash: string, language: LanguageCode): Promise<CachedTranslation | undefined>;
  set(sourceHash: string, language: LanguageCode, entry: CachedTranslation): Promise<void>;
}

/** sha256 of the Italian source text. */
export function sourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** For tests and the simulator: lives as long as the process. */
export class MemoryTranslationCache implements TranslationCache {
  private readonly entries = new Map<string, CachedTranslation>();

  get(hash: string, language: LanguageCode): Promise<CachedTranslation | undefined> {
    return Promise.resolve(this.entries.get(`${hash}:${language}`));
  }

  set(hash: string, language: LanguageCode, entry: CachedTranslation): Promise<void> {
    this.entries.set(`${hash}:${language}`, entry);
    return Promise.resolve();
  }

  get size(): number {
    return this.entries.size;
  }
}
