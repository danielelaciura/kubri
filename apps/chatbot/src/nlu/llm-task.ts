import type { CallTiming } from "./call-policy";
import type { NluConfig } from "./config";
import type { LlmProvider } from "./llm-provider";
import type { NluTraceSink } from "./trace";

/** What every LLM-backed task (interpret, translate) needs. */
export interface LlmTaskOptions {
  readonly provider: LlmProvider;
  readonly config: NluConfig;
  readonly traces: NluTraceSink;
  readonly timing: CallTiming;
  /** ISO-8601, for the traces. */
  readonly now: () => string;
}
