import { describe, expect, it } from "vitest";
import {
  calibrate,
  CalibrationCaseSchema,
  MIN_AGREEMENT,
  type CalibrationCase,
} from "../../../../src/evals/translation/calibration";
import type { Judge } from "../../../../src/nlu/judge";

const labelled = (id: string, fidelity: number, naturalness: number): CalibrationCase =>
  CalibrationCaseSchema.parse({
    id,
    language: "en",
    kind: "system",
    source: "s",
    translation: "t",
    human: { fidelity, naturalness },
  });

const judgeReturning = (
  scores: Record<string, { fidelity: number; naturalness: number } | null>,
): Judge => ({
  // The source text carries the case id, so the fake judge can look it up.
  score: (input) => {
    const score = scores[input.source];
    return Promise.resolve(score ? { ...score, issues: [], model: "judge-2411" } : null);
  },
});

const withSource = (c: CalibrationCase): CalibrationCase => ({ ...c, source: c.id });

describe("calibrate (D100)", () => {
  it("requires 90% agreement within one point", () => {
    expect(MIN_AGREEMENT).toBe(0.9);
  });

  it("measures agreement, error and bias against the human grades", async () => {
    const cases = [labelled("a", 5, 5), labelled("b", 3, 4), labelled("c", 1, 4)].map(withSource);
    const judge = judgeReturning({
      a: { fidelity: 5, naturalness: 5 },
      b: { fidelity: 4, naturalness: 4 },
      c: { fidelity: 4, naturalness: 3 },
    });

    const report = await calibrate(cases, judge);

    expect(report.cases).toBe(3);
    expect(report.judged).toBe(3);
    expect(report.withinOne).toEqual({ fidelity: 2 / 3, naturalness: 1 });
    expect(report.meanAbsError.fidelity).toBeCloseTo(4 / 3);
    expect(report.bias.fidelity).toBeCloseTo(4 / 3);
    expect(report.bias.naturalness).toBeCloseTo(-1 / 3);
    expect(report.disagreements).toEqual([{ id: "c", dimension: "fidelity", human: 1, judge: 4 }]);
    expect(report.ok).toBe(false);
    expect(report.answeredBy).toEqual(["judge-2411"]);
  });

  it("is ok when both dimensions agree enough", async () => {
    const cases = [labelled("a", 5, 5), labelled("b", 2, 3)].map(withSource);
    const judge = judgeReturning({
      a: { fidelity: 5, naturalness: 4 },
      b: { fidelity: 3, naturalness: 3 },
    });

    expect((await calibrate(cases, judge)).ok).toBe(true);
  });

  it("counts a missing grade as a disagreement and reports it", async () => {
    const cases = [labelled("a", 5, 5)].map(withSource);

    const report = await calibrate(cases, judgeReturning({ a: null }));

    expect(report).toMatchObject({
      judged: 0,
      ok: false,
      bias: { fidelity: null, naturalness: null },
    });
    expect(report.withinOne).toEqual({ fidelity: 0, naturalness: 0 });
    expect(report.disagreements[0]).toMatchObject({ id: "a", judge: null });
  });

  it("does not pass when more than one model graded: it calibrated no single judge (E8)", async () => {
    const cases = [labelled("a", 5, 5), labelled("b", 5, 5)].map(withSource);
    const models = ["judge-2411", "judge-2502"];
    const judge: Judge = {
      score: () =>
        Promise.resolve({ fidelity: 5, naturalness: 5, issues: [], model: models.shift() ?? "" }),
    };

    const report = await calibrate(cases, judge);

    expect(report.withinOne).toEqual({ fidelity: 1, naturalness: 1 });
    expect(report.answeredBy).toEqual(["judge-2411", "judge-2502"]);
    expect(report.ok).toBe(false);
  });
});
