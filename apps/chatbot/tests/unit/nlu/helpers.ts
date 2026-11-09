import type { CallTiming } from "../../../src/nlu/call-policy";
import { parseNluConfig } from "../../../src/nlu/config";
import type { LlmProvider } from "../../../src/nlu/llm-provider";
import type { LlmTaskOptions } from "../../../src/nlu/llm-task";
import { MemoryTraceSink, type NluTraceSink } from "../../../src/nlu/trace";

export const NOW = "2026-10-24T10:00:00.000Z";

/** No real waits in tests. */
export function fakeTiming(): CallTiming & { slept: number[] } {
  const slept: number[] = [];
  let now = 0;
  return {
    slept,
    retryDelaysMs: [500, 1500],
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    clock: () => (now += 5),
  };
}

export function taskOptions(
  provider: LlmProvider,
  traces: NluTraceSink = new MemoryTraceSink(),
): LlmTaskOptions & { timing: ReturnType<typeof fakeTiming> } {
  return { provider, config: parseNluConfig({}), traces, timing: fakeTiming(), now: () => NOW };
}

export function interpretationJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    language: { code: "it", confidence: 0.98 },
    intent: "answer",
    patch: [],
    currentQuestion: { completeness: "absent" },
    ...overrides,
  });
}
