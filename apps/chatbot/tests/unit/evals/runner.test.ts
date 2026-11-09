import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../../src/engine/interpretation";
import { runCases, type InterpretFn } from "../../../src/evals/runner";
import type { ContextInterpretResult } from "../../../src/nlu/interpret";
import type { NluTraceRecord } from "../../../src/nlu/trace";
import { campaign, interpretation } from "../engine/helpers";
import { makeCase } from "./helpers";
import { oracleInterpret } from "./oracle";

const c = campaign();

function clock(step = 25): () => number {
  let now = 0;
  return () => (now += step);
}

function reply(
  interp: Interpretation | null = interpretation(),
  overrides: Partial<ContextInterpretResult> = {},
): ContextInterpretResult {
  return {
    interpretation: interp,
    raw: interp && JSON.stringify(interp),
    valid: interp !== null,
    repaired: false,
    traces: [],
    ...overrides,
  };
}

function record(turnId: string | null, costEstimate: number | null): NluTraceRecord {
  return {
    turnId,
    task: "interpret",
    promptVersion: "p",
    provider: "fake",
    model: "m",
    attempt: "primary",
    repair: false,
    input: [],
    output: null,
    valid: true,
    latencyMs: 1,
    inputTokens: 1,
    outputTokens: 1,
    costEstimate,
    error: null,
    at: "2026-10-24T10:00:00.000Z",
  };
}

const base = { campaign: c, historyMessages: 3, deadlineMs: 20_000 } as const;

describe("runCases", () => {
  it("scores every case in order, with the latency of each call", async () => {
    const cases = [
      makeCase({ id: "a", expected: { patch: { firstName: "Mario" } } }),
      makeCase({ id: "b", expected: { intent: "help" } }),
    ];

    const results = await runCases({
      ...base,
      cases,
      interpret: oracleInterpret(cases),
      clock: clock(),
    });

    expect(results.map((r) => [r.id, r.pass, r.latencyMs])).toEqual([
      ["a", true, 25],
      ["b", true, 25],
    ]);
  });

  it("gives the NLU the production context of the case (D92)", async () => {
    const seen: unknown[] = [];
    const interpret: InterpretFn = (request) => {
      seen.push(request.turnId, request.message, request.context.question?.field);
      seen.push(request.context.history, request.defaultLanguage);
      return Promise.resolve(reply());
    };

    await runCases({
      ...base,
      historyMessages: 1,
      cases: [makeCase({ id: "z", message: "ciao", history: ["uno", "due"] })],
      interpret,
      clock: clock(),
    });

    expect(seen).toEqual(["z", "ciao", "firstName", ["due"], "it"]);
  });

  it("treats a failing NLU as unavailable (D96)", async () => {
    const [result] = await runCases({
      ...base,
      cases: [makeCase({ expected: { intent: "answer" } })],
      interpret: () => Promise.reject(new Error("boom")),
      clock: clock(),
    });

    expect(result).toMatchObject({ pass: false, actual: null, failure: "unavailable" });
  });

  it("fails an output that stayed invalid, and counts the repair (E2)", async () => {
    const [result] = await runCases({
      ...base,
      cases: [makeCase({ expected: { intent: "unclear" } })],
      interpret: () =>
        Promise.resolve(
          reply(interpretation({ intent: "unclear" }), { valid: false, repaired: true }),
        ),
      clock: clock(),
    });

    expect(result).toMatchObject({
      pass: false,
      failure: "invalid_output",
      nlu: { repaired: 1, invalidOutput: 1 },
    });
  });

  it("marks a case slower than the deadline without failing it (E3)", async () => {
    const [slow] = await runCases({
      ...base,
      deadlineMs: 20,
      cases: [makeCase({ expected: {} })],
      interpret: () => Promise.resolve(reply()),
      clock: clock(),
    });

    expect(slow).toMatchObject({ pass: true, nlu: { overDeadline: 1 } });
  });

  it("sums the cost of the traces of each case", async () => {
    const interpret: InterpretFn = (request) =>
      Promise.resolve(
        reply(interpretation(), {
          traces: [record(request.turnId, 0.001), record(request.turnId, 0.002)],
        }),
      );

    const results = await runCases({
      ...base,
      cases: [makeCase({ id: "a" }), makeCase({ id: "b" })],
      interpret,
      clock: clock(),
    });

    expect(results.map((r) => r.costEstimate)).toEqual([
      expect.closeTo(0.003),
      expect.closeTo(0.003),
    ]);
  });

  it("records the model of the last reply, as the provider reported it (D96)", async () => {
    const answered = { ...record("c1", null), model: "m-2026-10", output: "{}" };
    const failed = { ...record("c1", null), model: "m", output: null, attempt: "retry" as const };
    const [result] = await runCases({
      ...base,
      cases: [makeCase()],
      interpret: () => Promise.resolve(reply(interpretation(), { traces: [answered, failed] })),
      clock: clock(),
    });

    expect(result?.runScores.map((r) => r.answeredBy)).toEqual(["m-2026-10"]);
  });

  it("leaves the cost empty without traces", async () => {
    const [result] = await runCases({
      ...base,
      cases: [makeCase()],
      interpret: () => Promise.resolve(reply()),
      clock: clock(),
    });

    expect(result?.costEstimate).toBeNull();
  });

  describe("with --repeat (E6)", () => {
    it("passes a case only when every run passes, and reports the failing run", async () => {
      const answers = [interpretation(), interpretation({ intent: "help" }), interpretation()];
      const [result] = await runCases({
        ...base,
        repeat: 3,
        cases: [makeCase({ expected: { intent: "answer" } })],
        interpret: () => Promise.resolve(reply(answers.shift() ?? null)),
        clock: clock(),
      });

      expect(result).toMatchObject({
        pass: false,
        actual: { intent: "help" },
        nlu: { runs: 3, passed: 2 },
        latencyMs: 25,
      });
    });

    it("passes a stable case and adds up the cost of every run", async () => {
      const [result] = await runCases({
        ...base,
        repeat: 2,
        cases: [makeCase({ expected: { intent: "answer" } })],
        interpret: (request) =>
          Promise.resolve(
            reply(interpretation(), {
              traces: [record(request.turnId, 0.001)],
            }),
          ),
        clock: clock(),
      });

      expect(result).toMatchObject({ pass: true, nlu: { runs: 2, passed: 2 } });
      expect(result?.costEstimate).toBeCloseTo(0.002);
    });

    it("refuses a repeat count below 1", async () => {
      await expect(
        runCases({
          ...base,
          repeat: 0,
          cases: [makeCase()],
          interpret: () => Promise.resolve(reply()),
          clock: clock(),
        }),
      ).rejects.toThrow(/repeat/);
    });
  });
});
