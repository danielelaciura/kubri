import type { ReportView } from "./report";

export interface Comparison {
  readonly improved: readonly string[];
  readonly worsened: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: number;
  /** false = the dataset changed: only the common cases are comparable (D97). */
  readonly sameDataset: boolean;
  readonly passRateDelta: number;
  readonly hallucinationRateDelta: number | null;
  readonly intentAccuracyDelta: number | null;
  /** Candidate minus baseline, for the languages present in both. */
  readonly languageDeltas: Readonly<Record<string, number>>;
  /** The smaller number of cases of the two runs, per language in `languageDeltas` (E6). */
  readonly languageCases: Readonly<Record<string, number>>;
}

function delta(base: number | null, candidate: number | null): number | null {
  return base === null || candidate === null ? null : candidate - base;
}

export function compareReports(base: ReportView, candidate: ReportView): Comparison {
  const before = new Map(base.cases.map((c) => [c.id, c.pass]));
  const now = new Set(candidate.cases.map((c) => c.id));
  const improved: string[] = [];
  const worsened: string[] = [];
  const added: string[] = [];
  let unchanged = 0;
  for (const c of candidate.cases) {
    const was = before.get(c.id);
    if (was === undefined) added.push(c.id);
    else if (!was && c.pass) improved.push(c.id);
    else if (was && !c.pass) worsened.push(c.id);
    else unchanged += 1;
  }
  const languageDeltas: Record<string, number> = {};
  const languageCases: Record<string, number> = {};
  for (const [language, { passRate, cases }] of Object.entries(candidate.metrics.byLanguage)) {
    const before = base.metrics.byLanguage[language];
    if (before === undefined) continue;
    languageDeltas[language] = passRate - before.passRate;
    languageCases[language] = Math.min(cases, before.cases);
  }
  return {
    improved,
    worsened,
    added,
    removed: base.cases.filter((c) => !now.has(c.id)).map((c) => c.id),
    unchanged,
    sameDataset: base.meta.datasetHash === candidate.meta.datasetHash,
    passRateDelta: candidate.metrics.passRate - base.metrics.passRate,
    hallucinationRateDelta: delta(
      base.metrics.hallucination.rate,
      candidate.metrics.hallucination.rate,
    ),
    intentAccuracyDelta: delta(base.metrics.intent.accuracy, candidate.metrics.intent.accuracy),
    languageDeltas,
    languageCases,
  };
}
