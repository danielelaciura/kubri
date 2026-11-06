import type { CallAttempt } from "./call-policy";
import type { ModelPrice } from "./config";
import type { LlmMessage, LlmUsage } from "./llm-provider";

export type NluTask = "interpret" | "translate";

/**
 * Spec §10.3, plus `attempt` and `repair` (D87).
 *
 * What it stores, and why no more (spec §8.2, D85):
 * - `input`: the messages sent **without the system prompt** (`traceInput`), which
 *   `promptVersion` already identifies. What is left is the minimized context (personal
 *   and sensitive fields withheld, history redacted, no pending value) and the current message
 *   whole, or the Italian template for `translate`: exactly what the LLM saw, nothing more.
 *   Never the session state or the profile.
 * - `output`: the raw reply, needed to debug and to build eval cases. It may hold personal
 *   data: patch values and evidence from the current message, the saved part of a partial
 *   answer, or whatever the model wrote.
 * - `error`: kind and message of LlmError, which never carry a body (D80).
 *
 * It holds the candidate's words: it goes to the database (plan 08, deleted with the contact,
 * with a retention period still to be set, spec §18), never to logs.
 */
export interface NluTraceRecord {
  readonly turnId: string | null;
  readonly task: NluTask;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly attempt: CallAttempt["kind"];
  /** The repair call after an invalid output (D83). */
  readonly repair: boolean;
  readonly input: readonly LlmMessage[];
  readonly output: string | null;
  /** The output parsed and passed the schema. */
  readonly valid: boolean;
  readonly latencyMs: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costEstimate: number | null;
  readonly error: string | null;
  readonly at: string;
}

/** Implemented by store in plan 08 (table NluTrace). */
export interface NluTraceSink {
  write(record: NluTraceRecord): Promise<void>;
}

export class MemoryTraceSink implements NluTraceSink {
  readonly records: NluTraceRecord[] = [];

  write(record: NluTraceRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
}

export const NOOP_TRACE_SINK: NluTraceSink = { write: () => Promise.resolve() };

/** The trace's `input`: the system prompt is left out, `promptVersion` names it. */
export function traceInput(messages: readonly LlmMessage[]): LlmMessage[] {
  return messages.filter((message) => message.role !== "system");
}

export function estimateCost(
  model: string,
  usage: LlmUsage,
  prices: Readonly<Record<string, ModelPrice>>,
): number | null {
  const price = prices[model];
  if (!price) return null;
  return (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1e6;
}

export interface TraceBase {
  readonly turnId: string | null;
  readonly task: NluTask;
  readonly promptVersion: string;
  readonly provider: string;
  readonly repair: boolean;
  readonly input: readonly LlmMessage[];
  readonly at: string;
}

/** One record per call; only the last one, if answered, can carry `lastValid`. */
export function attemptTraces(
  base: TraceBase,
  attempts: readonly CallAttempt[],
  lastValid: boolean,
  prices: Readonly<Record<string, ModelPrice>>,
): NluTraceRecord[] {
  return attempts.map((a, index) => {
    const usage = a.response?.usage ?? null;
    return {
      ...base,
      model: a.response?.model ?? a.model,
      attempt: a.kind,
      output: a.response?.content ?? null,
      valid: a.response !== null && index === attempts.length - 1 && lastValid,
      latencyMs: a.latencyMs,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      // Prices are keyed by the configured (requested) model name.
      costEstimate: usage ? estimateCost(a.model, usage, prices) : null,
      error: a.error ? `${a.error.kind}: ${a.error.message}` : null,
    };
  });
}

/** D87: a trace never fails the turn. The store logs its own errors (plan 08). */
export async function writeTracesSafely(
  sink: NluTraceSink,
  records: readonly NluTraceRecord[],
): Promise<void> {
  for (const record of records) {
    try {
      await sink.write(record);
    } catch {
      // Dropped on purpose: the candidate's turn matters more than its trace.
    }
  }
}
