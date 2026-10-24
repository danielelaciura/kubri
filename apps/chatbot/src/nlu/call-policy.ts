import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./llm-provider";

export interface CallTiming {
  /** The wait before each retry of the primary model (spec §8.4: 2 retries, growing). */
  readonly retryDelaysMs: readonly number[];
  readonly sleep: (ms: number) => Promise<void>;
  /** Milliseconds, for latencies. */
  readonly clock: () => number;
}

export const REAL_TIMING: CallTiming = {
  retryDelaysMs: [500, 1500],
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock: () => performance.now(),
};

export interface CallAttempt {
  readonly kind: "primary" | "retry" | "fallback";
  readonly model: string;
  readonly latencyMs: number;
  readonly response: LlmResponse | null;
  readonly error: LlmError | null;
}

export interface CallResult {
  /** null = the LLM is unavailable for this call. */
  readonly response: LlmResponse | null;
  /** Every call made, for NluTrace (D87). */
  readonly attempts: readonly CallAttempt[];
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  // A foreign exception's message is not trusted: it could carry the prompt.
  return new LlmError("server", "provider failure");
}

async function attempt(
  provider: LlmProvider,
  request: LlmRequest,
  kind: CallAttempt["kind"],
  clock: () => number,
): Promise<CallAttempt> {
  const started = clock();
  try {
    const response = await provider.complete(request);
    return { kind, model: request.model, latencyMs: clock() - started, response, error: null };
  } catch (error: unknown) {
    return {
      kind,
      model: request.model,
      latencyMs: clock() - started,
      response: null,
      error: toLlmError(error),
    };
  }
}

/** D82: retry what is worth retrying, then the fallback model once; stop on client errors. */
export async function callWithPolicy(
  provider: LlmProvider,
  request: LlmRequest,
  fallbackModel: string,
  timing: CallTiming,
): Promise<CallResult> {
  const attempts: CallAttempt[] = [];
  const waits = [0, ...timing.retryDelaysMs];
  for (const [index, wait] of waits.entries()) {
    if (wait > 0) await timing.sleep(wait);
    const result = await attempt(
      provider,
      request,
      index === 0 ? "primary" : "retry",
      timing.clock,
    );
    attempts.push(result);
    if (result.response) return { response: result.response, attempts };
    if (!result.error?.retryable) return { response: null, attempts };
  }
  const fallback = await attempt(
    provider,
    { ...request, model: fallbackModel },
    "fallback",
    timing.clock,
  );
  attempts.push(fallback);
  return { response: fallback.response, attempts };
}
