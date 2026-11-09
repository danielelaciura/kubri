import { describe, expect, it } from "vitest";
import { compareReports } from "../../../src/evals/compare";
import { languageCases, view } from "./helpers";

describe("compareReports", () => {
  it("lists improved, worsened, added and removed cases by id", () => {
    const comparison = compareReports(
      view({ cases: { a: false, b: true, c: true, d: true } }),
      view({ cases: { a: true, b: false, c: true, e: true } }),
    );

    expect(comparison).toMatchObject({
      improved: ["a"],
      worsened: ["b"],
      added: ["e"],
      removed: ["d"],
      unchanged: 1,
      sameDataset: true,
    });
  });

  it("computes metric deltas, null when either side is not measurable", () => {
    const comparison = compareReports(
      view({
        passRate: 0.8,
        hallucination: 0.02,
        intent: 0.9,
        cases: { ...languageCases("it", 10), ...languageCases("ar", 5, 1) },
      }),
      view({
        passRate: 0.9,
        hallucination: 0.01,
        intent: null,
        cases: { ...languageCases("it", 10, 1), ...languageCases("fr", 3) },
      }),
    );

    expect(comparison.passRateDelta).toBeCloseTo(0.1);
    expect(comparison.hallucinationRateDelta).toBeCloseTo(-0.01);
    expect(comparison.intentAccuracyDelta).toBeNull();
    expect(Object.keys(comparison.languageDeltas)).toEqual(["it"]);
    expect(comparison.languageDeltas["it"]).toBeCloseTo(-0.1);
  });

  it("compares each language on the cases present in both runs, case by case (D97, E6)", () => {
    const comparison = compareReports(
      view({ cases: { ...languageCases("it", 12), ...languageCases("ar", 3) } }),
      view({ cases: { ...languageCases("it", 10), ...languageCases("ar", 4) } }),
    );

    expect(comparison.languageCases).toEqual({ it: 10, ar: 3 });
  });

  it("does not let removed hard cases hide a language that got worse (D97)", () => {
    // Baseline: 10 easy cases pass, 10 hard ones fail (50%). The candidate's dataset dropped the
    // hard ones and fails 2 easy ones (80%): better on the whole, worse on every common case.
    const easy = (failed: number) => languageCases("ar", 10, failed);
    const hard = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`ar-hard-${i}`, { pass: false, language: "ar" }]),
    );

    const comparison = compareReports(
      view({ cases: { ...easy(0), ...hard }, datasetHash: "a" }),
      view({ cases: easy(2), datasetHash: "b" }),
    );

    expect(comparison.languageDeltas["ar"]).toBeCloseTo(-0.2);
    expect(comparison.languageCases).toEqual({ ar: 10 });
  });

  it("leaves out a case whose language changed between the runs", () => {
    const comparison = compareReports(
      view({ cases: { x: { pass: true, language: "ar" } } }),
      view({ cases: { x: { pass: false, language: "fr" } } }),
    );

    expect(comparison.languageDeltas).toEqual({});
  });

  it("flags a dataset that changed between the two runs", () => {
    expect(compareReports(view({ datasetHash: "a" }), view({ datasetHash: "b" })).sameDataset).toBe(
      false,
    );
  });
});
