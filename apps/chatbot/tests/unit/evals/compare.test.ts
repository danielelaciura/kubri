import { describe, expect, it } from "vitest";
import { compareReports } from "../../../src/evals/compare";
import { view } from "./helpers";

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
      view({ passRate: 0.8, hallucination: 0.02, intent: 0.9, byLanguage: { it: 1, ar: 0.8 } }),
      view({ passRate: 0.9, hallucination: 0.01, intent: null, byLanguage: { it: 0.9, fr: 1 } }),
    );

    expect(comparison.passRateDelta).toBeCloseTo(0.1);
    expect(comparison.hallucinationRateDelta).toBeCloseTo(-0.01);
    expect(comparison.intentAccuracyDelta).toBeNull();
    expect(Object.keys(comparison.languageDeltas)).toEqual(["it"]);
    expect(comparison.languageDeltas["it"]).toBeCloseTo(-0.1);
  });

  it("keeps, for each common language, the smaller number of cases (E6)", () => {
    const comparison = compareReports(
      view({ byLanguage: { it: { passRate: 1, cases: 12 }, ar: { passRate: 1, cases: 3 } } }),
      view({ byLanguage: { it: { passRate: 1, cases: 10 }, ar: { passRate: 1, cases: 4 } } }),
    );

    expect(comparison.languageCases).toEqual({ it: 10, ar: 3 });
  });

  it("flags a dataset that changed between the two runs", () => {
    expect(compareReports(view({ datasetHash: "a" }), view({ datasetHash: "b" })).sameDataset).toBe(
      false,
    );
  });
});
