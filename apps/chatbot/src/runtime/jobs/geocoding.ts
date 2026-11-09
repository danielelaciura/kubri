import type { Logger } from "pino";
import type { JobPayloads } from "../../store/queue";

/**
 * D124: the dashboard geocodes the address on every send, with the landing's chain (Google,
 * then ISTAT), so nothing is geocoded here. The engine still enqueues the job when the address
 * changes; closing it keeps the queue empty and leaves the reason on record.
 */
export function handleGeocoding(
  deps: { readonly logger: Logger },
  job: JobPayloads["geocoding"],
): Promise<void> {
  deps.logger.info({ sessionId: job.sessionId }, "geocoding delegated to the dashboard");
  return Promise.resolve();
}
