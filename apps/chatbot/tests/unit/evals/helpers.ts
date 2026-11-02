import { EvalCaseSchema, type EvalCase } from "../../../src/evals/case";
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
