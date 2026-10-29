import type { RuntimeConfig } from "./config";

/**
 * How long to wait before running the turn: 0 = run now. The quiet time counts from the
 * newest message, the maximum from the oldest (D106). Dates are the database's: the same clock
 * for every message, so a skew with the worker's only shifts the wait a little.
 */
export function debounceWaitMs(
  config: Pick<RuntimeConfig, "debounceMs" | "debounceMaxWaitMs">,
  burst: readonly { readonly createdAt: Date }[],
  now: Date,
): number {
  if (config.debounceMs === 0 || burst.length === 0) return 0;
  const times = burst.map((m) => m.createdAt.getTime());
  const quietFor = now.getTime() - Math.max(...times);
  const waited = now.getTime() - Math.min(...times);
  if (quietFor >= config.debounceMs || waited >= config.debounceMaxWaitMs) return 0;
  return Math.min(config.debounceMs - quietFor, config.debounceMaxWaitMs - waited);
}
