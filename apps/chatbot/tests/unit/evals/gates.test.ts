import { describe, expect, it } from "vitest";
import { compareReports } from "../../../src/evals/compare";
import {
  DEFAULT_THRESHOLDS,
  evaluateGates,
  MIN_CASES_PER_LANGUAGE,
} from "../../../src/evals/gates";
import { languageCases, view } from "./helpers";

const gate = (results: ReturnType<typeof evaluateGates>, name: string) =>
  results.find((r) => r.name === name);

describe("evaluateGates (D98)", () => {
  it("has the thresholds of spec §15.4", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({
      maxHallucinationRate: 0.01,
      minIntentAccuracy: 0.95,
      minLanguageAccuracy: 0.95,
      maxLanguageRegression: 0.02,
      maxUnavailableRate: 0.02,
      maxInvalidOutputRate: 0.02,
    });
  });

  it("passes at the limits", () => {
    const results = evaluateGates(
      view({
        hallucination: 0.01,
        intent: 0.95,
        language: 0.95,
        unavailable: 0.02,
        invalidOutput: 0.02,
      }),
      null,
    );

    expect(results.every((r) => r.ok)).toBe(true);
  });

  it.each([
    ["hallucination", { hallucination: 0.02 }],
    ["intent accuracy", { intent: 0.9 }],
    ["language accuracy", { language: 0.9 }],
    ["unavailable", { intent: 1, unavailable: 0.03 }],
    ["invalid output", { intent: 1, invalidOutput: 0.03 }],
  ])("fails %s over the limit", (name, report) => {
    const results = evaluateGates(view(report), null);

    expect(gate(results, name)).toMatchObject({ ok: false, skipped: false });
  });

  it("skips a gate that cannot be measured instead of passing it", () => {
    const results = evaluateGates(view({ intent: 1 }), null);

    expect(results.map((r) => [r.name, r.skipped, r.ok])).toEqual([
      ["unavailable", false, true],
      ["invalid output", false, true],
      ["hallucination", true, true],
      ["intent accuracy", false, true],
      ["language accuracy", true, true],
      ["language regression", true, true],
    ]);
  });

  it("fails a run where every quality gate was skipped: nothing was measured (D98)", () => {
    const results = evaluateGates(view({}), null);

    expect(gate(results, "quality gates")).toMatchObject({ ok: false, skipped: false });
    expect(gate(results, "quality gates")?.detail).toMatch(/no gate applied/);
  });

  it("skips the call gates when there was no call", () => {
    const results = evaluateGates(
      view({ intent: 1, unavailable: null, invalidOutput: null }),
      null,
    );

    expect(gate(results, "unavailable")).toMatchObject({ ok: true, skipped: true });
    expect(gate(results, "invalid output")).toMatchObject({ ok: true, skipped: true });
  });

  it("fails a language that lost more than 2 points against the baseline", () => {
    const base = view({
      cases: {
        ...languageCases("it", 100),
        ...languageCases("ar", 100),
        ...languageCases("fr", 100),
      },
    });
    const candidate = view({
      cases: {
        ...languageCases("it", 100, 1),
        ...languageCases("ar", 100, 3),
        ...languageCases("fr", 100),
      },
    });

    const result = gate(
      evaluateGates(candidate, compareReports(base, candidate)),
      "language regression",
    );

    expect(result).toMatchObject({ ok: false, skipped: false });
    expect(result?.detail).toContain("ar -3.0");
    expect(result?.detail).not.toContain("it ");
  });

  it("accepts a loss of exactly 2 points", () => {
    const base = view({ cases: languageCases("ar", 100) });
    const candidate = view({ cases: languageCases("ar", 100, 2) });

    expect(
      gate(evaluateGates(candidate, compareReports(base, candidate)), "language regression")?.ok,
    ).toBe(true);
  });

  it("gates only the languages with enough cases in both runs, the rest is informational (E6)", () => {
    expect(MIN_CASES_PER_LANGUAGE).toBe(10);
    const base = view({ cases: { ...languageCases("it", 10), ...languageCases("ar", 2) } });
    const candidate = view({
      cases: { ...languageCases("it", 10, 1), ...languageCases("ar", 2, 1) },
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
    const base = view({ cases: languageCases("ar", 2) });
    const candidate = view({ cases: languageCases("ar", 2, 2) });

    const result = gate(
      evaluateGates(candidate, compareReports(base, candidate)),
      "language regression",
    );

    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(result?.detail).toContain("ar -100.0");
  });
});
