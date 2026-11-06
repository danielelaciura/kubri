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
  /**
   * Per language, candidate minus baseline pass rate over the same cases: the ids present in
   * both runs with the same language (D97). A dataset change cannot move it.
   */
  readonly languageDeltas: Readonly<Record<string, number>>;
  /** How many common cases each language in `languageDeltas` was compared on (E6). */
  readonly languageCases: Readonly<Record<string, number>>;
}

function delta(base: number | null, candidate: number | null): number | null {
  return base === null || candidate === null ? null : candidate - base;
}

/** D97: per language, the pass rates of the two runs on the cases they share. */
function compareLanguages(base: ReportView, candidate: ReportView) {
  const before = new Map(base.cases.map((c) => [c.id, c]));
  const totals = new Map<string, { cases: number; before: number; now: number }>();
  for (const c of candidate.cases) {
    const was = before.get(c.id);
    // A case that changed language is another case: nothing to compare.
    if (was === undefined || was.language !== c.language) continue;
    const total = totals.get(c.language) ?? { cases: 0, before: 0, now: 0 };
    total.cases += 1;
    if (was.pass) total.before += 1;
    if (c.pass) total.now += 1;
    totals.set(c.language, total);
  }
  const languageDeltas: Record<string, number> = {};
  const languageCases: Record<string, number> = {};
  for (const [language, total] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    languageDeltas[language] = (total.now - total.before) / total.cases;
    languageCases[language] = total.cases;
  }
  return { languageDeltas, languageCases };
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
  const { languageDeltas, languageCases } = compareLanguages(base, candidate);
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
