import { EvalCaseSchema, type EvalCase } from "../../../src/evals/case";
import type { ReportView } from "../../../src/evals/report";
import type { CaseResult, RunStats } from "../../../src/evals/score-case";

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
  answeredBy: "m",
};

/** A case of a test ReportView: its outcome alone (language `it`), or with its language. */
type CaseView = boolean | { readonly pass: boolean; readonly language: string };

/** `total` cases of one language, ids `<language>-<n>`; the last `failed` of them fail. */
export function languageCases(
  language: string,
  total: number,
  failed = 0,
): Record<string, { pass: boolean; language: string }> {
  return Object.fromEntries(
    Array.from({ length: total }, (_, i) => [
      `${language}-${i}`,
      { pass: i < total - failed, language },
    ]),
  );
}

/** A test ReportView: only what comparison and gates read. */
export function view(overrides: {
  cases?: Record<string, CaseView>;
  passRate?: number;
  hallucination?: number | null;
  intent?: number | null;
  language?: number | null;
  invalidOutput?: number | null;
  unavailable?: number | null;
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
      language: { accuracy: overrides.language ?? null },
      nlu: {
        invalidOutputRate: overrides.invalidOutput === undefined ? 0 : overrides.invalidOutput,
        unavailableRate: overrides.unavailable === undefined ? 0 : overrides.unavailable,
      },
    },
    cases: Object.entries(overrides.cases ?? {}).map(([id, value]) =>
      typeof value === "boolean" ? { id, pass: value, language: "it" } : { id, ...value },
    ),
  };
}

/** A one-run CaseResult whose run score is the shown checks, patch and failure. */
export function oneRun(result: Omit<CaseResult, "runScores">): CaseResult {
  const { checks, patch, failure } = result;
  return {
    ...result,
    runScores: [{ checks, patch, failure, answeredBy: failure === "unavailable" ? null : "m" }],
  };
}
