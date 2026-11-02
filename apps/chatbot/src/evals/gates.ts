import type { Comparison } from "./compare";
import type { ReportView } from "./report";

/** Spec §15.4 (initial values, to be tuned). */
export const DEFAULT_THRESHOLDS = {
  maxHallucinationRate: 0.01,
  minIntentAccuracy: 0.95,
  maxLanguageRegression: 0.02,
} as const;

export type Thresholds = typeof DEFAULT_THRESHOLDS;

/**
 * E6: below this many cases (in both runs) one case moves a language by 10+ points, so its
 * change is shown but does not block.
 */
export const MIN_CASES_PER_LANGUAGE = 10;

export interface GateResult {
  readonly name: string;
  readonly ok: boolean;
  /** Not measurable: it neither passes nor fails (D98). */
  readonly skipped: boolean;
  readonly detail: string;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const points = (value: number): string => (value * 100).toFixed(1);
// Rates are ratios of small integers: compare with a tolerance, not with ===.
const EPSILON = 1e-9;

function gate(name: string, ok: boolean, detail: string): GateResult {
  return { name, ok, skipped: false, detail };
}

function skipped(name: string, why: string): GateResult {
  return { name, ok: true, skipped: true, detail: `skipped: ${why}` };
}

const signedPoints = (value: number): string => `${value >= 0 ? "+" : ""}${points(value)}`;

function languageGate(comparison: Comparison, thresholds: Thresholds): GateResult {
  const name = "language regression";
  const deltas = Object.entries(comparison.languageDeltas);
  const enough = ([language]: [string, number]): boolean =>
    (comparison.languageCases[language] ?? 0) >= MIN_CASES_PER_LANGUAGE;
  const gated = deltas.filter(enough);
  const informational = deltas.filter((entry) => !enough(entry));
  const note =
    informational.length === 0
      ? ""
      : `; informational (< ${MIN_CASES_PER_LANGUAGE} cases): ${informational
          .map(([language, change]) => `${language} ${signedPoints(change)}`)
          .join(", ")}`;
  if (gated.length === 0) {
    return skipped(name, `no language has ${MIN_CASES_PER_LANGUAGE} cases in both runs${note}`);
  }
  const regressed = gated.filter(
    ([, change]) => change < -thresholds.maxLanguageRegression - EPSILON,
  );
  return gate(
    name,
    regressed.length === 0,
    (regressed.length === 0
      ? `no language lost more than ${points(thresholds.maxLanguageRegression)} points`
      : regressed.map(([language, change]) => `${language} ${points(change)}`).join(", ")) + note,
  );
}

export function evaluateGates(
  candidate: ReportView,
  comparison: Comparison | null,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): GateResult[] {
  const hallucination = candidate.metrics.hallucination.rate;
  const intent = candidate.metrics.intent.accuracy;
  const results: GateResult[] = [
    hallucination === null
      ? skipped("hallucination", "no field was extracted")
      : gate(
          "hallucination",
          hallucination <= thresholds.maxHallucinationRate + EPSILON,
          `${pct(hallucination)} (max ${pct(thresholds.maxHallucinationRate)})`,
        ),
    intent === null
      ? skipped("intent accuracy", "no case expects an intent")
      : gate(
          "intent accuracy",
          intent >= thresholds.minIntentAccuracy - EPSILON,
          `${pct(intent)} (min ${pct(thresholds.minIntentAccuracy)})`,
        ),
  ];
  if (comparison === null) {
    results.push(skipped("language regression", "no baseline"));
    return results;
  }
  results.push(languageGate(comparison, thresholds));
  return results;
}
