import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../../src/evals/metrics";
import type { CaseResult } from "../../../src/evals/score-case";
import { oneRun } from "./helpers";

function result(overrides: Partial<CaseResult> & { id: string }): CaseResult {
  return oneRun({
    tags: [],
    language: "it",
    checks: {},
    patch: { correct: [], wrong: [], invented: [], missing: [], extracted: 0 },
    pass: true,
    failure: null,
    nlu: { runs: 1, passed: 1, repaired: 0, invalidOutput: 0, unavailable: 0, overDeadline: 0 },
    latencyMs: 100,
    costEstimate: null,
    actual: null,
    ...overrides,
  });
}

const intent = (expected: string, actual: string | null) =>
  ({ expected, actual, ok: expected === actual }) as const;

describe("computeMetrics", () => {
  it("is well defined for an empty run", () => {
    const m = computeMetrics([]);

    expect(m).toMatchObject({ cases: 0, passed: 0, passRate: 0, avgLatencyMs: 0, totalCost: null });
    expect(m.intent).toEqual({ evaluated: 0, correct: 0, accuracy: null });
    expect(m.hallucination).toEqual({ invented: 0, extracted: 0, rate: null });
    expect(m.nlu).toEqual({
      runs: 0,
      repaired: 0,
      repairRate: null,
      invalidOutput: 0,
      invalidOutputRate: null,
      unavailable: 0,
      unavailableRate: null,
      overDeadline: 0,
      unstable: 0,
    });
  });

  it("counts invalid outputs, repairs, slow runs and unstable cases over every run (E2, E3, E6)", () => {
    const counts = (overrides: Partial<CaseResult["nlu"]>): CaseResult["nlu"] => ({
      runs: 1,
      passed: 1,
      repaired: 0,
      invalidOutput: 0,
      unavailable: 0,
      overDeadline: 0,
      ...overrides,
    });
    const m = computeMetrics([
      result({ id: "a", nlu: counts({ repaired: 1, overDeadline: 1 }) }),
      result({
        id: "b",
        pass: false,
        failure: "invalid_output",
        nlu: counts({ passed: 0, repaired: 1, invalidOutput: 1 }),
      }),
      result({ id: "c", pass: false, nlu: counts({ runs: 3, passed: 2, unavailable: 1 }) }),
    ]);

    expect(m.nlu).toEqual({
      runs: 5,
      repaired: 2,
      repairRate: 2 / 5,
      invalidOutput: 1,
      invalidOutputRate: 1 / 5,
      unavailable: 1,
      unavailableRate: 1 / 5,
      overDeadline: 1,
      unstable: 1,
    });
  });

  it("counts cases, accuracy per check, and the confusion matrix", () => {
    const m = computeMetrics([
      result({ id: "a", checks: { intent: intent("help", "help") } }),
      result({ id: "b", pass: false, checks: { intent: intent("help", "off_topic") } }),
      result({ id: "c", pass: false, checks: { intent: intent("opt_out", null) } }),
    ]);

    expect(m).toMatchObject({ cases: 3, passed: 1, passRate: 1 / 3 });
    expect(m.intent).toEqual({ evaluated: 3, correct: 1, accuracy: 1 / 3 });
    expect(m.confusion).toEqual({
      help: { help: 1, off_topic: 1 },
      opt_out: { none: 1 },
    });
  });

  it("computes the hallucination rate and per-field precision and recall", () => {
    const m = computeMetrics([
      result({
        id: "a",
        patch: {
          correct: ["firstName"],
          wrong: [],
          invented: ["email"],
          missing: [],
          extracted: 2,
        },
      }),
      result({
        id: "b",
        patch: {
          correct: [],
          wrong: ["firstName"],
          invented: [],
          missing: ["transport"],
          extracted: 1,
        },
      }),
    ]);

    expect(m.hallucination).toEqual({ invented: 1, extracted: 3, rate: 1 / 3 });
    expect(m.fields["firstName"]).toEqual({
      expected: 2,
      extracted: 2,
      correct: 1,
      wrong: 1,
      invented: 0,
      missing: 0,
      precision: 0.5,
      recall: 0.5,
    });
    expect(m.fields["email"]).toMatchObject({
      expected: 0,
      extracted: 1,
      precision: 0,
      recall: null,
    });
    expect(m.fields["transport"]).toMatchObject({
      expected: 1,
      extracted: 0,
      precision: null,
      recall: 0,
    });
  });

  it("splits the passed cases by language and by tag", () => {
    const m = computeMetrics([
      result({ id: "a", language: "it", tags: ["bool"] }),
      result({ id: "b", language: "ar", tags: ["bool", "early-answer"], pass: false }),
      result({ id: "c", language: "ar", tags: ["bool"] }),
    ]);

    expect(m.byLanguage).toEqual({
      ar: { cases: 2, passed: 1, passRate: 0.5 },
      it: { cases: 1, passed: 1, passRate: 1 },
    });
    expect(m.byTag["bool"]).toEqual({ cases: 3, passed: 2, passRate: 2 / 3 });
    expect(m.byTag["early-answer"]).toEqual({ cases: 1, passed: 0, passRate: 0 });
  });

  it("averages latency and sums the known costs", () => {
    const m = computeMetrics([
      result({ id: "a", latencyMs: 100, costEstimate: 0.001 }),
      result({ id: "b", latencyMs: 300, costEstimate: null }),
      result({ id: "c", latencyMs: 200, costEstimate: 0.002 }),
    ]);

    expect(m.avgLatencyMs).toBe(200);
    expect(m.totalCost).toBeCloseTo(0.003);
  });
});
