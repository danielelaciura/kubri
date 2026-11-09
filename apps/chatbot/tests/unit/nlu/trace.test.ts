import { describe, expect, it } from "vitest";
import type { CallAttempt } from "../../../src/nlu/call-policy";
import { LlmError } from "../../../src/nlu/llm-provider";
import {
  attemptTraces,
  estimateCost,
  MemoryTraceSink,
  traceInput,
  writeTracesSafely,
  type NluTraceRecord,
} from "../../../src/nlu/trace";

const PRICES = { "m-small": { inputPerMTok: 0.1, outputPerMTok: 0.3 } };
const BASE = {
  turnId: "turn-1",
  task: "interpret",
  promptVersion: "interpret-v1",
  provider: "fake",
  repair: false,
  input: [],
  at: "2026-10-24T10:00:00.000Z",
} as const;

const failed: CallAttempt = {
  kind: "primary",
  model: "m-small",
  latencyMs: 30,
  response: null,
  error: new LlmError("server", "Mistral HTTP 503", 503),
};
const answered: CallAttempt = {
  kind: "retry",
  model: "m-small",
  latencyMs: 40,
  response: {
    content: "{}",
    model: "m-small-2506",
    usage: { inputTokens: 1000, outputTokens: 500 },
  },
  error: null,
};

describe("estimateCost", () => {
  it("uses the price per million tokens of the requested model", () => {
    expect(estimateCost("m-small", { inputTokens: 1000, outputTokens: 500 }, PRICES)).toBeCloseTo(
      0.00025,
    );
    expect(estimateCost("other", { inputTokens: 1, outputTokens: 1 }, PRICES)).toBeNull();
  });
});

describe("traceInput", () => {
  it("drops the system prompt, which promptVersion already identifies", () => {
    expect(
      traceInput([
        { role: "system", content: "long rules" },
        { role: "user", content: '{"message":"ciao"}' },
        { role: "assistant", content: "{}" },
      ]),
    ).toEqual([
      { role: "user", content: '{"message":"ciao"}' },
      { role: "assistant", content: "{}" },
    ]);
  });
});

describe("attemptTraces", () => {
  it("writes one record per call; only the answered last one can be valid", () => {
    expect(attemptTraces(BASE, [failed, answered], true, PRICES)).toEqual([
      {
        ...BASE,
        model: "m-small",
        attempt: "primary",
        output: null,
        valid: false,
        latencyMs: 30,
        inputTokens: null,
        outputTokens: null,
        costEstimate: null,
        error: "server: Mistral HTTP 503",
      },
      {
        ...BASE,
        model: "m-small-2506",
        attempt: "retry",
        output: "{}",
        valid: true,
        latencyMs: 40,
        inputTokens: 1000,
        outputTokens: 500,
        costEstimate: expect.closeTo(0.00025) as number,
        error: null,
      },
    ]);
  });

  it("never marks a record valid when the last output was invalid", () => {
    expect(attemptTraces(BASE, [answered], false, PRICES)[0]?.valid).toBe(false);
  });
});

describe("writeTracesSafely", () => {
  it("writes every record, and a failing sink never fails the turn (D87)", async () => {
    const sink = new MemoryTraceSink();
    const records = attemptTraces(BASE, [answered], true, PRICES);

    await writeTracesSafely(sink, records);
    await expect(
      writeTracesSafely({ write: () => Promise.reject(new Error("db down")) }, records),
    ).resolves.toBeUndefined();

    expect(sink.records).toEqual<NluTraceRecord[]>(records);
  });
});
