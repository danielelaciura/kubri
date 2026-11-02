import { describe, expect, it } from "vitest";
import { compareReports } from "../../../src/evals/compare";
import {
  DEFAULT_THRESHOLDS,
  evaluateGates,
  MIN_CASES_PER_LANGUAGE,
} from "../../../src/evals/gates";
import { view } from "./helpers";

const gate = (results: ReturnType<typeof evaluateGates>, name: string) =>
  results.find((r) => r.name === name);

describe("evaluateGates (D98)", () => {
  it("has the thresholds of spec §15.4", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({
      maxHallucinationRate: 0.01,
      minIntentAccuracy: 0.95,
      maxLanguageRegression: 0.02,
    });
  });

  it("passes at the limits", () => {
    const results = evaluateGates(view({ hallucination: 0.01, intent: 0.95 }), null);

    expect(results.every((r) => r.ok)).toBe(true);
  });

  it.each([
    ["hallucination", { hallucination: 0.02 }],
    ["intent accuracy", { intent: 0.9 }],
  ])("fails %s over the limit", (name, report) => {
    const results = evaluateGates(view(report), null);

    expect(gate(results, name)).toMatchObject({ ok: false, skipped: false });
  });

  it("skips a gate that cannot be measured instead of passing it", () => {
    const results = evaluateGates(view({}), null);

    expect(results.map((r) => [r.name, r.skipped, r.ok])).toEqual([
      ["hallucination", true, true],
      ["intent accuracy", true, true],
      ["language regression", true, true],
    ]);
  });

  it("fails a language that lost more than 2 points against the baseline", () => {
    const base = view({ byLanguage: { it: 1, ar: 1, fr: 1 } });
    const candidate = view({ byLanguage: { it: 0.99, ar: 0.97, fr: 1 } });

    const result = gate(
      evaluateGates(candidate, compareReports(base, candidate)),
      "language regression",
    );

    expect(result).toMatchObject({ ok: false, skipped: false });
    expect(result?.detail).toContain("ar -3.0");
    expect(result?.detail).not.toContain("it ");
  });

  it("accepts a loss of exactly 2 points", () => {
    const base = view({ byLanguage: { ar: 1 } });
    const candidate = view({ byLanguage: { ar: 0.98 } });

    expect(
      gate(evaluateGates(candidate, compareReports(base, candidate)), "language regression")?.ok,
    ).toBe(true);
  });

  it("gates only the languages with enough cases in both runs, the rest is informational (E6)", () => {
    expect(MIN_CASES_PER_LANGUAGE).toBe(10);
    const base = view({
      byLanguage: { it: { passRate: 1, cases: 10 }, ar: { passRate: 1, cases: 2 } },
    });
    const candidate = view({
      byLanguage: { it: { passRate: 0.9, cases: 10 }, ar: { passRate: 0.5, cases: 2 } },
    });

    const result = gate(
      evaluateGates(candidate, compareReports(base, candidate)),
      "language regression",
    );

    expect(result).toMatchObject({ ok: false, skipped: false });
    expect(result?.detail).toContain("it -10.0");
    expect(result?.detail).toContain("informational (< 10 cases): ar -50.0");
  });

  it("skips the language gate when no language has enough cases", () => {
    const base = view({ byLanguage: { ar: { passRate: 1, cases: 2 } } });
    const candidate = view({ byLanguage: { ar: { passRate: 0, cases: 2 } } });

    const result = gate(
      evaluateGates(candidate, compareReports(base, candidate)),
      "language regression",
    );

    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(result?.detail).toContain("ar -100.0");
  });
});
