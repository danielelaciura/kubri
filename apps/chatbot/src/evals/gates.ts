import type { Comparison } from "./compare";
import type { ReportView } from "./report";

/** Spec §15.4 and D98 (initial values, to be tuned). */
export const DEFAULT_THRESHOLDS = {
  /** Fields saved that the candidate never said, over the fields saved. */
  maxHallucinationRate: 0.01,
  minIntentAccuracy: 0.95,
  /** Over the cases that expect a language (the `language` suite). */
  minLanguageAccuracy: 0.95,
  /** Points of passed cases a language may lose against the baseline. */
  maxLanguageRegression: 0.02,
  /**
   * Calls with no reply at all (D82). Such a run measured the provider, not the model: above
   * this, its accuracies say nothing about a prompt or a model.
   */
  maxUnavailableRate: 0.02,
  /** Replies still invalid after the repair (D83): the model does not follow the schema. */
  maxInvalidOutputRate: 0.02,
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

function atMost(name: string, value: number | null, max: number, why: string): GateResult {
  return value === null
    ? skipped(name, why)
    : gate(name, value <= max + EPSILON, `${pct(value)} (max ${pct(max)})`);
}

function atLeast(name: string, value: number | null, min: number, why: string): GateResult {
  return value === null
    ? skipped(name, why)
    : gate(name, value >= min - EPSILON, `${pct(value)} (min ${pct(min)})`);
}

/**
 * D98. Call gates first (was the model there to be measured?), then quality gates (how well
 * it understood). A run where every quality gate was skipped measured nothing: it fails, so an
 * empty or unanswered run can never pass, nor become a baseline.
 */
export function evaluateGates(
  candidate: ReportView,
  comparison: Comparison | null,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): GateResult[] {
  const { metrics } = candidate;
  const calls: GateResult[] = [
    atMost("unavailable", metrics.nlu.unavailableRate, thresholds.maxUnavailableRate, "no call"),
    atMost(
      "invalid output",
      metrics.nlu.invalidOutputRate,
      thresholds.maxInvalidOutputRate,
      "no call",
    ),
  ];
  const quality: GateResult[] = [
    atMost(
      "hallucination",
      metrics.hallucination.rate,
      thresholds.maxHallucinationRate,
      "no field was extracted",
    ),
    atLeast(
      "intent accuracy",
      metrics.intent.accuracy,
      thresholds.minIntentAccuracy,
      "no case expects an intent",
    ),
    atLeast(
      "language accuracy",
      metrics.language.accuracy,
      thresholds.minLanguageAccuracy,
      "no case expects a language",
    ),
    comparison === null
      ? skipped("language regression", "no baseline")
      : languageGate(comparison, thresholds),
  ];
  const none = quality.every((g) => g.skipped)
    ? [gate("quality gates", false, "no gate applied: this run measured nothing")]
    : [];
  return [...calls, ...quality, ...none];
}
