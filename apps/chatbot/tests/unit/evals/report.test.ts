import { describe, expect, it } from "vitest";
import { compareReports } from "../../../src/evals/compare";
import { evaluateGates } from "../../../src/evals/gates";
import { computeMetrics } from "../../../src/evals/metrics";
import {
  buildReport,
  comparisonMarkdown,
  datasetHash,
  parseReport,
  reportToMarkdown,
  type ReportMeta,
} from "../../../src/evals/report";
import type { CaseResult } from "../../../src/evals/score-case";

const META: ReportMeta = {
  suite: "intent",
  createdAt: "2026-10-24T10:00:00.000Z",
  promptVersion: "interpret-v1",
  models: { interpret: "m-small", fallback: "m-medium" },
  provider: "mistral",
  datasetHash: datasetHash("a\nb\n"),
  campaign: "campaigns/kubri-standard.json",
  repeat: 1,
  deadlineMs: 20_000,
};

const passing: CaseResult = {
  id: "stop-1",
  tags: ["global"],
  language: "it",
  checks: { intent: { expected: "opt_out", actual: "opt_out", ok: true } },
  patch: { correct: [], wrong: [], invented: [], missing: [], extracted: 0 },
  pass: true,
  failure: null,
  nlu: { runs: 1, passed: 1, repaired: 0, invalidOutput: 0, unavailable: 0, overDeadline: 0 },
  latencyMs: 120,
  costEstimate: 0.001,
  actual: null,
};
const failing: CaseResult = {
  ...passing,
  id: "help-1",
  language: "ar",
  pass: false,
  checks: { intent: { expected: "help", actual: "off_topic", ok: false } },
  patch: {
    correct: [],
    wrong: ["firstName"],
    invented: ["email"],
    missing: ["transport"],
    extracted: 2,
  },
};

describe("datasetHash", () => {
  it("changes with the content", () => {
    expect(datasetHash("a")).toMatch(/^[0-9a-f]{64}$/);
    expect(datasetHash("a")).not.toBe(datasetHash("b"));
  });
});

describe("buildReport and parseReport", () => {
  it("round-trips through JSON", () => {
    const report = buildReport(META, [passing, failing]);

    const parsed = parseReport(JSON.stringify(report));

    expect(parsed.meta.suite).toBe("intent");
    expect(parsed.cases).toEqual([
      expect.objectContaining({ id: "stop-1", pass: true }),
      expect.objectContaining({ id: "help-1", pass: false }),
    ]);
    expect(report.metrics).toEqual(computeMetrics([passing, failing]));
  });

  it("refuses what is not a report", () => {
    expect(() => parseReport("{ nope")).toThrow(/not valid JSON/);
    expect(() => parseReport("{}")).toThrow(/not an eval report/);
  });
});

describe("reportToMarkdown", () => {
  const report = buildReport(META, [passing, failing]);

  it("has the headline, the confusion matrix and the failures with the reason", () => {
    const md = reportToMarkdown(report);

    expect(md).toContain("# Evals · intent");
    expect(md).toContain("interpret-v1");
    expect(md).toContain("1/2 (50.0%)");
    expect(md).toContain("| atteso \\ ottenuto | off_topic | opt_out |");
    expect(md).toContain("| help | 1 | 0 |");
    expect(md).toContain("`help-1` (ar)");
    expect(md).toContain("intent: expected help, got off_topic");
    expect(md).toContain("invented: email");
    expect(md).toContain("wrong: firstName");
    expect(md).toContain("missing: transport");
  });

  it("shows how the calls went and why the NLU gave nothing usable (E2, E3, E6)", () => {
    const broken: CaseResult = {
      ...passing,
      id: "broken-1",
      pass: false,
      failure: "invalid_output",
      nlu: { runs: 2, passed: 1, repaired: 2, invalidOutput: 1, unavailable: 0, overDeadline: 1 },
    };
    const down: CaseResult = {
      ...passing,
      id: "down-1",
      pass: false,
      failure: "unavailable",
      nlu: { runs: 1, passed: 0, repaired: 0, invalidOutput: 0, unavailable: 1, overDeadline: 0 },
    };

    const md = reportToMarkdown(buildReport({ ...META, repeat: 2 }, [broken, down]));

    expect(md).toContain("Ripetizioni per caso: 2 · scadenza NLU: 20000 ms");
    expect(md).toContain("| 1/3 (33.3%) | 2/3 (66.7%) | 1 | 1 | 1 |");
    expect(md).toContain("`broken-1` (it) — invalid output after the repair · passed 1/2 runs");
    expect(md).toContain("`down-1` (it) — NLU unavailable");
  });

  it("shows gates and the comparison when given", () => {
    const base = parseReport(
      JSON.stringify(buildReport(META, [{ ...passing }, { ...failing, pass: true }])),
    );
    const view = parseReport(JSON.stringify(report));
    const comparison = compareReports(base, view);

    const md = reportToMarkdown(report, comparison, evaluateGates(view, comparison));

    expect(md).toContain("## Soglie");
    expect(md).toContain("## Confronto con il riferimento");
    expect(md).toContain("`help-1`");
    expect(md).toContain("ar -100.0 (1 casi, informativo)");
  });
});

describe("comparisonMarkdown", () => {
  it("warns when the dataset changed", () => {
    const a = parseReport(JSON.stringify(buildReport(META, [passing])));
    const b = parseReport(JSON.stringify(buildReport({ ...META, datasetHash: "x" }, [passing])));

    expect(comparisonMarkdown(compareReports(a, b)).join("\n")).toContain("dataset diverso");
  });
});
