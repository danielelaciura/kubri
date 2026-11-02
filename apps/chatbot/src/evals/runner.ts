import type { CampaignDefinition } from "../campaigns/schema/campaign";
import { buildInterpretContext } from "../nlu/context";
import type { ContextInterpretRequest, ContextInterpretResult } from "../nlu/interpret";
import type { NluTraceRecord } from "../nlu/trace";
import { toInterpretRequest, type EvalCase } from "./case";
import { scoreCase, type CaseResult, type NluCounts } from "./score-case";

/**
 * The task under evaluation: `interpretContext` bound to a provider, a model and a prompt (the
 * candidate, D99). Not the Interpreter contract: evals must see `valid` and `repaired`, which
 * the contract hides behind the `unclear` fallback (E2).
 */
export type InterpretFn = (request: ContextInterpretRequest) => Promise<ContextInterpretResult>;

export interface RunOptions {
  readonly cases: readonly EvalCase[];
  readonly campaign: CampaignDefinition;
  readonly interpret: InterpretFn;
  /** Earlier messages in the context, as in production (NLU_HISTORY_MESSAGES). */
  readonly historyMessages: number;
  /** Milliseconds (performance.now in the CLI, a counter in tests). */
  readonly clock: () => number;
  /** Production gives up on the NLU after this long (TURN_NLU_DEADLINE_MS, E3). */
  readonly deadlineMs: number;
  /** Runs per case (E6): a case passes only when every run passes. Default 1. */
  readonly repeat?: number;
}

function costOf(traces: readonly NluTraceRecord[]): number | null {
  const costs = traces.flatMap((record) =>
    record.costEstimate === null ? [] : [record.costEstimate],
  );
  return costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0);
}

function toRequest(c: EvalCase, options: RunOptions): ContextInterpretRequest {
  const request = toInterpretRequest(c, options.campaign);
  return {
    // The real context builder (D92): the LLM sees what production would show it.
    context: buildInterpretContext(request, options.historyMessages),
    message: c.message,
    turnId: c.id,
    defaultLanguage: options.campaign.defaultLanguage,
  };
}

async function runOnce(c: EvalCase, options: RunOptions): Promise<CaseResult> {
  const started = options.clock();
  let result: ContextInterpretResult | null;
  try {
    result = await options.interpret(toRequest(c, options));
  } catch {
    // D96: as in runtime, an NLU that throws is an unavailable NLU.
    result = null;
  }
  const latencyMs = options.clock() - started;
  return scoreCase(c, options.campaign, result?.interpretation ?? null, {
    latencyMs,
    costEstimate: result ? costOf(result.traces) : null,
    valid: result?.valid ?? false,
    repaired: result?.repaired ?? false,
    overDeadline: latencyMs > options.deadlineMs,
  });
}

function sumCounts(runs: readonly CaseResult[]): NluCounts {
  const sum = (pick: (counts: NluCounts) => number): number =>
    runs.reduce((total, run) => total + pick(run.nlu), 0);
  return {
    runs: sum((n) => n.runs),
    passed: sum((n) => n.passed),
    repaired: sum((n) => n.repaired),
    invalidOutput: sum((n) => n.invalidOutput),
    unavailable: sum((n) => n.unavailable),
    overDeadline: sum((n) => n.overDeadline),
  };
}

/**
 * E6: one result for every run of a case. It shows the first failing run (the one to read),
 * or the last when all passed, and keeps the score of every run for the metrics; latency is the
 * mean, cost the total.
 */
function combineRuns(runs: readonly CaseResult[]): CaseResult {
  const last = runs[runs.length - 1];
  if (!last) throw new Error("combineRuns needs at least one run");
  if (runs.length === 1) return last;
  const shown = runs.find((run) => !run.pass) ?? last;
  const costs = runs.flatMap((run) => (run.costEstimate === null ? [] : [run.costEstimate]));
  return {
    ...shown,
    runScores: runs.flatMap((run) => run.runScores),
    nlu: sumCounts(runs),
    latencyMs: runs.reduce((sum, run) => sum + run.latencyMs, 0) / runs.length,
    costEstimate: costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0),
  };
}

/** D96: one case at a time, `repeat` runs each, in order. */
export async function runCases(options: RunOptions): Promise<CaseResult[]> {
  const repeat = options.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`repeat must be a whole number of at least 1, got ${String(repeat)}`);
  }
  const results: CaseResult[] = [];
  for (const c of options.cases) {
    const runs: CaseResult[] = [];
    for (let i = 0; i < repeat; i += 1) runs.push(await runOnce(c, options));
    results.push(combineRuns(runs));
  }
  return results;
}
