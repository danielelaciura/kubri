import { describe, expect, it } from "vitest";
import type { NluTraceRecord } from "../../../src/nlu/trace";
import { TurnTraces } from "../../../src/runtime/turn-traces";

const record = (model: string): NluTraceRecord => ({
  turnId: "t1",
  task: "interpret",
  promptVersion: "p1",
  provider: "fake",
  model,
  attempt: "primary",
  repair: false,
  input: [],
  output: null,
  valid: false,
  latencyMs: 1,
  inputTokens: null,
  outputTokens: null,
  costEstimate: null,
  error: null,
  at: "2026-10-29T10:00:00.000Z",
});

describe("TurnTraces", () => {
  it("collects the traces written before the freeze, in order", async () => {
    const traces = new TurnTraces();
    await traces.write(record("a"));
    await traces.write(record("b"));

    expect(traces.freeze().map((r) => r.model)).toEqual(["a", "b"]);
  });

  it("drops what an interpreter still running writes after the freeze, and counts it", async () => {
    const traces = new TurnTraces();
    await traces.write(record("a"));
    const frozen = traces.freeze();
    await traces.write(record("late"));

    expect(frozen.map((r) => r.model)).toEqual(["a"]);
    expect(traces.freeze().map((r) => r.model)).toEqual(["a"]);
    expect(traces.dropped).toBe(1);
  });
});
