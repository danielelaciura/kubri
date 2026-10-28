import type { CachedTranslation, TranslationCache } from "../i18n/translation-cache";
import type { LanguageCode } from "../i18n/localized-text";
import { Prisma } from "../generated/prisma/client";
import type { LlmMessage } from "../nlu/llm-provider";
import type { NluTraceRecord, NluTraceSink } from "../nlu/trace";
import type { Database, Tx } from "./db";
import { asJson } from "./json";

export interface TraceRow {
  readonly turnId: string | null;
  readonly task: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly attempt: string;
  readonly repair: boolean;
  /** null on retries and fallbacks; stored as SQL NULL. */
  readonly input: readonly LlmMessage[] | null;
  readonly output: string | null;
  readonly valid: boolean;
  readonly latencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costEstimate: number | null;
  readonly error: string | null;
  readonly createdAt: Date;
}

/**
 * D110: retries and the fallback send the same messages as the call that started the chain
 * (primary or repair), so only that one keeps its `input`.
 */
export function toTraceRows(records: readonly NluTraceRecord[]): TraceRow[] {
  return records.map((r) => ({
    turnId: r.turnId,
    task: r.task,
    promptVersion: r.promptVersion,
    provider: r.provider,
    model: r.model,
    attempt: r.attempt,
    repair: r.repair,
    input: r.attempt === "primary" ? r.input : null,
    output: r.output,
    valid: r.valid,
    latencyMs: Math.round(r.latencyMs),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costEstimate: r.costEstimate,
    error: r.error,
    createdAt: new Date(r.at),
  }));
}

/** The turn's traces, written in its transaction (the turn row must exist already). */
export async function insertTraces(tx: Tx, records: readonly NluTraceRecord[]): Promise<void> {
  if (records.length === 0) return;
  await tx.nluTrace.createMany({
    data: toTraceRows(records).map((row) => ({
      ...row,
      input: row.input === null ? Prisma.DbNull : asJson(row.input),
    })),
  });
}

/** For traces that belong to no turn (translations): written straight away. */
export function createDatabaseTraceSink(db: Database): NluTraceSink {
  return { write: (record) => insertTraces(db, [record]) };
}

export function createDatabaseTranslationCache(db: Database): TranslationCache {
  return {
    async get(sourceHash: string, language: LanguageCode): Promise<CachedTranslation | undefined> {
      const row = await db.translationCache.findUnique({
        where: { sourceHash_language: { sourceHash, language } },
      });
      return row
        ? { text: row.text, reviewed: row.reviewed, provider: row.provider, model: row.model }
        : undefined;
    },
    async set(sourceHash: string, language: LanguageCode, entry: CachedTranslation): Promise<void> {
      const data = {
        text: entry.text,
        reviewed: entry.reviewed,
        provider: entry.provider,
        model: entry.model,
      };
      await db.translationCache.upsert({
        where: { sourceHash_language: { sourceHash, language } },
        create: { sourceHash, language, ...data },
        update: data,
      });
    },
  };
}
