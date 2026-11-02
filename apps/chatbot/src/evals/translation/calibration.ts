import { z } from "zod";
import { LanguageCodeSchema } from "../../i18n/localized-text";
import type { Judge, JudgeScore } from "../../nlu/judge";
import { TRANSLATION_KINDS } from "./case";

/**
 * D100: the judge is a measuring instrument, so it is checked against a person's grades of the
 * same translations. Agreement within one point is what matters; bias (judge minus person) shows
 * a judge that is systematically too generous, which is worse than one that is just noisy.
 */

/** D100: the judge's grades are usable if they stay within one point of a person's this often. */
export const MIN_AGREEMENT = 0.9;

const Grade = z.number().int().min(1).max(5);

export const CalibrationCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
  language: LanguageCodeSchema,
  kind: z.enum(TRANSLATION_KINDS),
  source: z.string().min(1),
  translation: z.string().min(1),
  /** Graded by a person with the same rubric as the judge. */
  human: z.strictObject({ fidelity: Grade, naturalness: Grade }),
});
export type CalibrationCase = z.infer<typeof CalibrationCaseSchema>;

type Dimension = "fidelity" | "naturalness";
const DIMENSIONS: readonly Dimension[] = ["fidelity", "naturalness"];

export interface Disagreement {
  readonly id: string;
  readonly dimension: Dimension;
  readonly human: number;
  /** null = the judge gave no grade. */
  readonly judge: number | null;
}

export interface CalibrationReport {
  readonly cases: number;
  readonly judged: number;
  /** Share of all cases (a missing grade counts as a miss) within one point. */
  readonly withinOne: Readonly<Record<Dimension, number>>;
  readonly meanAbsError: Readonly<Record<Dimension, number | null>>;
  /** Judge minus human: positive = too generous. */
  readonly bias: Readonly<Record<Dimension, number | null>>;
  /** Two or more points apart, or no grade. */
  readonly disagreements: readonly Disagreement[];
  /** The models that actually graded, sorted: never another model than asked (E8). */
  readonly answeredBy: readonly string[];
  /** Agreement high enough, and one single model graded (an alias that moved mid-run did not). */
  readonly ok: boolean;
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

export async function calibrate(
  cases: readonly CalibrationCase[],
  judge: Judge,
): Promise<CalibrationReport> {
  const rows: { readonly c: CalibrationCase; readonly score: JudgeScore | null }[] = [];
  for (const c of cases) {
    const score = await judge.score({
      source: c.source,
      translation: c.translation,
      language: c.language,
      kind: c.kind,
    });
    rows.push({ c, score });
  }
  const disagreements: Disagreement[] = [];
  const stats = (dimension: Dimension) => {
    const diffs = rows.flatMap(({ c, score }) =>
      score ? [score[dimension] - c.human[dimension]] : [],
    );
    for (const { c, score } of rows) {
      const human = c.human[dimension];
      if (!score || Math.abs(score[dimension] - human) >= 2) {
        disagreements.push({ id: c.id, dimension, human, judge: score?.[dimension] ?? null });
      }
    }
    return {
      within: rows.length === 0 ? 0 : diffs.filter((d) => Math.abs(d) <= 1).length / rows.length,
      abs: mean(diffs.map(Math.abs)),
      bias: mean(diffs),
    };
  };
  const [fidelity, naturalness] = DIMENSIONS.map(stats);
  const answeredBy = [...new Set(rows.flatMap(({ score }) => (score ? [score.model] : [])))].sort();
  if (!fidelity || !naturalness) throw new Error("unreachable: two dimensions");
  return {
    cases: rows.length,
    judged: rows.filter((r) => r.score !== null).length,
    withinOne: { fidelity: fidelity.within, naturalness: naturalness.within },
    meanAbsError: { fidelity: fidelity.abs, naturalness: naturalness.abs },
    bias: { fidelity: fidelity.bias, naturalness: naturalness.bias },
    disagreements,
    answeredBy,
    ok:
      rows.length > 0 &&
      answeredBy.length === 1 &&
      fidelity.within >= MIN_AGREEMENT &&
      naturalness.within >= MIN_AGREEMENT,
  };
}
