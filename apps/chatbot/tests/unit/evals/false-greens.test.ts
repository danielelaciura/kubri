import { describe, expect, it } from "vitest";
import type { Interpretation } from "../../../src/engine/interpretation";
import { evaluateGates, type GateResult } from "../../../src/evals/gates";
import { buildReport, datasetHash, parseReport, type ReportMeta } from "../../../src/evals/report";
import { runCases, type InterpretFn } from "../../../src/evals/runner";
import type { ContextInterpretResult } from "../../../src/nlu/interpret";
import { unclearInterpretation } from "../../../src/nlu/interpret";
import { campaign, interpretation } from "../engine/helpers";
import { makeCase } from "./helpers";

/**
 * The review's reproductions: runs that looked green while the NLU was broken. Each goes the
 * whole way, runner → report → gates, as `evals run` does.
 */

const META: ReportMeta = {
  suite: "intent",
  createdAt: "2026-10-24T10:00:00.000Z",
  promptVersion: "interpret-v1",
  models: { interpret: "m-small", fallback: null },
  provider: "fake",
  datasetHash: datasetHash(""),
  campaign: "c.json",
  repeat: 1,
  deadlineMs: 20_000,
};
const entry = (field: string, value: unknown) => ({ field, value, confidence: 0.95, evidence: "" });
const base = { campaign: campaign(), historyMessages: 3, deadlineMs: 20_000, clock: () => 0 };

function valid(interp: Interpretation): ContextInterpretResult {
  return { interpretation: interp, raw: "{}", valid: true, repaired: false, traces: [] };
}

async function gatesOf(options: Parameters<typeof runCases>[0], repeat = 1) {
  const results = await runCases({ ...options, repeat });
  const report = buildReport({ ...META, repeat }, results);
  const gates = evaluateGates(parseReport(JSON.stringify(report)), null);
  return { report, gates };
}

const gate = (gates: readonly GateResult[], name: string) => gates.find((g) => g.name === name);

describe("false greens", () => {
  it("counts an invalid output as a wrong intent, which the intent gate sees (E2)", async () => {
    const cases = [
      makeCase({ id: "broken", expected: { intent: "unclear" } }),
      makeCase({ id: "fine", expected: { intent: "answer" } }),
    ];
    const interpret: InterpretFn = (request) =>
      Promise.resolve(
        request.turnId === "broken"
          ? {
              interpretation: unclearInterpretation("it"),
              raw: "{",
              valid: false,
              repaired: true,
              traces: [],
            }
          : valid(interpretation()),
      );

    const { report, gates } = await gatesOf({ ...base, cases, interpret });

    expect(report.metrics.intent).toEqual({ evaluated: 2, correct: 1, accuracy: 0.5 });
    expect(report.metrics.confusion).toEqual({
      unclear: { invalid: 1 },
      answer: { answer: 1 },
    });
    expect(gate(gates, "intent accuracy")).toMatchObject({ ok: false, skipped: false });
  });

  it("does not count the language of the `unclear` fallback as a right language", async () => {
    const cases = [makeCase({ id: "broken", expected: { language: "it" } })];
    const interpret: InterpretFn = () =>
      Promise.resolve({
        interpretation: unclearInterpretation("it"),
        raw: "{",
        valid: false,
        repaired: true,
        traces: [],
      });

    const { report } = await gatesOf({ ...base, cases, interpret });

    expect(report.metrics.language).toEqual({ evaluated: 1, correct: 0, accuracy: 0 });
  });

  it("counts the hallucinations of every run with --repeat, not only the run shown (E6)", async () => {
    const cases = [makeCase({ id: "name", expected: { patch: { firstName: "Mario" } } })];
    const answers = [
      interpretation({ patch: [] }),
      interpretation({ patch: [entry("firstName", "Mario"), entry("lastName", "Rossi")] }),
    ];
    const interpret: InterpretFn = () =>
      Promise.resolve(valid(answers.shift() ?? interpretation()));

    const { report, gates } = await gatesOf({ ...base, cases, interpret }, 2);

    expect(report.metrics.hallucination).toEqual({ invented: 1, extracted: 2, rate: 0.5 });
    expect(report.metrics.fields).toMatchObject({
      firstName: { expected: 2, correct: 1, missing: 1 },
      lastName: { invented: 1 },
    });
    expect(gate(gates, "hallucination")).toMatchObject({ ok: false, skipped: false });
  });

  it("counts intent accuracy over every run with --repeat (E6)", async () => {
    const cases = [makeCase({ id: "help", expected: { intent: "help" } })];
    const answers = [interpretation({ intent: "help" }), interpretation({ intent: "answer" })];
    const interpret: InterpretFn = () =>
      Promise.resolve(valid(answers.shift() ?? interpretation()));

    const { report } = await gatesOf({ ...base, cases, interpret }, 2);

    expect(report.metrics.intent).toEqual({ evaluated: 2, correct: 1, accuracy: 0.5 });
    expect(report.metrics.confusion).toEqual({ help: { help: 1, answer: 1 } });
  });
});
