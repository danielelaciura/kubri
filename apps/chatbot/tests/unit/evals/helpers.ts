import { EvalCaseSchema, type EvalCase } from "../../../src/evals/case";

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

export const STATS = { latencyMs: 10, costEstimate: null } as const;
