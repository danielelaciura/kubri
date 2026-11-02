import { EvalCaseSchema, type EvalCase } from "../../../src/evals/case";
import type { ReportView } from "../../../src/evals/report";
import type { RunStats } from "../../../src/evals/score-case";

/** A valid case on the minimal test campaign; `raw` overrides the raw JSON fields. */
export function makeCase(raw: Record<string, unknown> = {}): EvalCase {
  return EvalCaseSchema.parse({
    id: "c1",
    language: "it",
    state: { step: "anagrafica", question: "nome" },
    message: "Mario",
    expected: {},
    ...raw,
  });
}

/** One clean run: a valid reply, no repair, inside the deadline. */
export const STATS: RunStats = {
  latencyMs: 10,
  costEstimate: null,
  valid: true,
  repaired: false,
  overDeadline: false,
};

/** A language's pass rate, alone (enough cases to be gated) or with its number of cases. */
type LanguageView = number | { readonly passRate: number; readonly cases: number };

/** A test ReportView: only what comparison and gates read. */
export function view(overrides: {
  cases?: Record<string, boolean>;
  passRate?: number;
  hallucination?: number | null;
  intent?: number | null;
  byLanguage?: Record<string, LanguageView>;
  datasetHash?: string;
}): ReportView {
  return {
    version: 1,
    meta: {
      suite: "intent",
      createdAt: "2026-10-24T10:00:00.000Z",
      promptVersion: "interpret-v1",
      datasetHash: overrides.datasetHash ?? "h1",
    },
    metrics: {
      passRate: overrides.passRate ?? 0.9,
      hallucination: { rate: overrides.hallucination ?? null },
      intent: { accuracy: overrides.intent ?? null },
      byLanguage: Object.fromEntries(
        Object.entries(overrides.byLanguage ?? {}).map(([lang, value]) => [
          lang,
          typeof value === "number" ? { passRate: value, cases: 50 } : value,
        ]),
      ),
    },
    cases: Object.entries(overrides.cases ?? {}).map(([id, pass]) => ({ id, pass })),
  };
}
