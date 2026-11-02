import type { Interpretation } from "../../../src/engine/interpretation";
import type { EvalCase } from "../../../src/evals/case";
import type { InterpretFn } from "../../../src/evals/runner";

/** Exactly what the case expects, as the NLU would return it. */
export function expectedInterpretation(c: EvalCase): Interpretation {
  const { expected } = c;
  return {
    language: { code: expected.language ?? c.language, confidence: 0.99 },
    intent: expected.intent ?? "answer",
    ...(expected.choice === undefined ? {} : { choice: expected.choice }),
    patch: Object.entries(expected.patch).map(([field, value]) => ({
      field,
      value,
      confidence: 0.95,
      evidence: "",
    })),
    currentQuestion: { completeness: expected.completeness ?? "absent" },
    ...(expected.editTarget === undefined ? {} : { editTarget: expected.editTarget }),
  };
}

/**
 * Answers every case with exactly what it expects. It proves that datasets and scorers agree,
 * without an LLM (D101): an oracle that fails a case means the case or the scorer is wrong.
 */
export function oracleInterpret(cases: readonly EvalCase[]): InterpretFn {
  const byId = new Map(cases.map((c) => [c.id, c]));
  return (request) => {
    const c = byId.get(request.turnId ?? "");
    if (!c) return Promise.reject(new Error(`oracle: unknown case ${request.turnId ?? "null"}`));
    const interpretation = expectedInterpretation(c);
    return Promise.resolve({
      interpretation,
      raw: JSON.stringify(interpretation),
      valid: true,
      repaired: false,
      traces: [],
    });
  };
}
