import type { CaseResult, Check, RunScore } from "./score-case";

export interface Ratio {
  readonly evaluated: number;
  readonly correct: number;
  /** null = no case checks this (nothing to divide). */
  readonly accuracy: number | null;
}

export interface FieldMetrics {
  expected: number;
  extracted: number;
  correct: number;
  wrong: number;
  invented: number;
  missing: number;
  precision: number | null;
  recall: number | null;
}

export interface GroupMetrics {
  readonly cases: number;
  readonly passed: number;
  readonly passRate: number;
}

/** How the calls went, over every run of every case (E2, E3, E6). */
export interface NluMetrics {
  readonly runs: number;
  /** Runs that needed a repair call (D83). */
  readonly repaired: number;
  readonly repairRate: number | null;
  /** Runs whose reply stayed invalid after the repair: each one fails its case. */
  readonly invalidOutput: number;
  readonly invalidOutputRate: number | null;
  /** Runs with no reply at all (D82). */
  readonly unavailable: number;
  /** Runs slower than the production deadline: the turn would have gone on without NLU. */
  readonly overDeadline: number;
  /** Cases that passed some runs and failed others (`--repeat`). */
  readonly unstable: number;
}

export interface Metrics {
  readonly cases: number;
  readonly passed: number;
  readonly passRate: number;
  /** D93: fields the engine would save that the candidate never said. */
  readonly hallucination: {
    readonly invented: number;
    readonly extracted: number;
    readonly rate: number | null;
  };
  readonly nlu: NluMetrics;
  readonly intent: Ratio;
  readonly choice: Ratio;
  readonly language: Ratio;
  readonly completeness: Ratio;
  readonly editTarget: Ratio;
  readonly fields: Readonly<Record<string, FieldMetrics>>;
  /** expected intent → actual intent ("none" = unavailable, "invalid" = invalid output) → count. */
  readonly confusion: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly byLanguage: Readonly<Record<string, GroupMetrics>>;
  readonly byTag: Readonly<Record<string, GroupMetrics>>;
  readonly avgLatencyMs: number;
  /** null = no case has a cost estimate. */
  readonly totalCost: number | null;
}

const divide = (a: number, b: number): number | null => (b === 0 ? null : a / b);

function ratio(
  runs: readonly RunScore[],
  pick: (r: RunScore) => Check<unknown> | undefined,
): Ratio {
  const checks = runs.map(pick).filter((item): item is Check<unknown> => item !== undefined);
  const correct = checks.filter((item) => item.ok).length;
  return { evaluated: checks.length, correct, accuracy: divide(correct, checks.length) };
}

function groups(
  results: readonly CaseResult[],
  keysOf: (r: CaseResult) => readonly string[],
): Record<string, GroupMetrics> {
  const totals = new Map<string, { cases: number; passed: number }>();
  for (const r of results) {
    for (const key of keysOf(r)) {
      const total = totals.get(key) ?? { cases: 0, passed: 0 };
      total.cases += 1;
      if (r.pass) total.passed += 1;
      totals.set(key, total);
    }
  }
  return Object.fromEntries(
    [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, t]) => [key, { ...t, passRate: t.passed / t.cases }]),
  );
}

function fieldMetrics(runs: readonly RunScore[]): Record<string, FieldMetrics> {
  const fields = new Map<string, FieldMetrics>();
  const entry = (field: string): FieldMetrics => {
    const existing = fields.get(field);
    if (existing) return existing;
    const created: FieldMetrics = {
      expected: 0,
      extracted: 0,
      correct: 0,
      wrong: 0,
      invented: 0,
      missing: 0,
      precision: null,
      recall: null,
    };
    fields.set(field, created);
    return created;
  };
  for (const { patch } of runs) {
    for (const f of patch.correct) {
      const m = entry(f);
      m.correct += 1;
      m.expected += 1;
      m.extracted += 1;
    }
    for (const f of patch.wrong) {
      const m = entry(f);
      m.wrong += 1;
      m.expected += 1;
      m.extracted += 1;
    }
    for (const f of patch.invented) {
      const m = entry(f);
      m.invented += 1;
      m.extracted += 1;
    }
    for (const f of patch.missing) {
      const m = entry(f);
      m.missing += 1;
      m.expected += 1;
    }
  }
  for (const m of fields.values()) {
    m.precision = divide(m.correct, m.extracted);
    m.recall = divide(m.correct, m.expected);
  }
  return Object.fromEntries([...fields.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function confusionMatrix(runs: readonly RunScore[]): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};
  for (const { checks, failure } of runs) {
    if (!checks.intent) continue;
    const row = (matrix[checks.intent.expected] ??= {});
    const column = failure === "invalid_output" ? "invalid" : (checks.intent.actual ?? "none");
    row[column] = (row[column] ?? 0) + 1;
  }
  return matrix;
}

function nluMetrics(results: readonly CaseResult[]): NluMetrics {
  const sum = (pick: (counts: CaseResult["nlu"]) => number): number =>
    results.reduce((total, r) => total + pick(r.nlu), 0);
  const runs = sum((n) => n.runs);
  const repaired = sum((n) => n.repaired);
  const invalidOutput = sum((n) => n.invalidOutput);
  return {
    runs,
    repaired,
    repairRate: divide(repaired, runs),
    invalidOutput,
    invalidOutputRate: divide(invalidOutput, runs),
    unavailable: sum((n) => n.unavailable),
    overDeadline: sum((n) => n.overDeadline),
    unstable: results.filter((r) => r.nlu.passed > 0 && r.nlu.passed < r.nlu.runs).length,
  };
}

/**
 * Pass rates count cases (a case passes only if every run passes); accuracies, hallucinations,
 * fields and the confusion matrix count runs, so `--repeat` hides no wrong answer (E6).
 */
export function computeMetrics(results: readonly CaseResult[]): Metrics {
  const passed = results.filter((r) => r.pass).length;
  const runs = results.flatMap((r) => r.runScores);
  const invented = runs.reduce((sum, r) => sum + r.patch.invented.length, 0);
  const extracted = runs.reduce((sum, r) => sum + r.patch.extracted, 0);
  const costs = results.flatMap((r) => (r.costEstimate === null ? [] : [r.costEstimate]));
  return {
    cases: results.length,
    passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    hallucination: { invented, extracted, rate: divide(invented, extracted) },
    nlu: nluMetrics(results),
    intent: ratio(runs, (r) => r.checks.intent),
    choice: ratio(runs, (r) => r.checks.choice),
    language: ratio(runs, (r) => r.checks.language),
    completeness: ratio(runs, (r) => r.checks.completeness),
    editTarget: ratio(runs, (r) => r.checks.editTarget),
    fields: fieldMetrics(runs),
    confusion: confusionMatrix(runs),
    byLanguage: groups(results, (r) => [r.language]),
    byTag: groups(results, (r) => r.tags),
    avgLatencyMs:
      results.length === 0 ? 0 : results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length,
    totalCost: costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0),
  };
}
