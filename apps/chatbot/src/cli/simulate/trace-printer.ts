import type { NluTraceSink } from "../../nlu/trace";

/** One line per LLM call, with no prompt and no reply: they hold personal data (D87). */
export function printingTraceSink(write: (line: string) => void): NluTraceSink {
  return {
    write: (r) => {
      const outcome = r.error ?? (r.valid ? "valid" : "invalid");
      write(
        `  ⋯ ${r.task}${r.repair ? " (repair)" : ""} ${r.model} ${r.attempt} ${Math.round(r.latencyMs)}ms in=${r.inputTokens ?? "?"} out=${r.outputTokens ?? "?"} ${outcome}`,
      );
      return Promise.resolve();
    },
  };
}
