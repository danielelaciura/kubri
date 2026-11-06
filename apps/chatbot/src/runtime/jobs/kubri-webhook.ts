import type { Logger } from "pino";
import type { KubriClient } from "../../integrations/kubri/client";
import { buildKubriPayload, KubriContractError } from "../../integrations/kubri/payload";
import type { Database } from "../../store/db";
import type { JobAttempt, JobPayloads, JobQueue } from "../../store/queue";
import { loadSnapshot, type Snapshot } from "../../store/snapshot";
import { insertFlag } from "../../store/turns";
import { TransientJobError } from "./errors";

export interface KubriJobDeps {
  readonly db: Database;
  readonly logger: Logger;
  readonly queue: JobQueue;
  /** null: this worker has no Kubri configuration (development only, R9). */
  readonly kubri: KubriClient | null;
}

export type KubriJobResult = "sent" | "skipped" | "dead";

/** The flag a definitive failure leaves on the session (R7): an operator looks, nothing stops. */
export const KUBRI_WEBHOOK_FAILED = "kubri_webhook_failed";

type Job = JobPayloads["kubri-webhook"];

/**
 * R7: an opt-out with deletion stops the session and empties its profile. Sending that would
 * replace the candidate in the dashboard with a blank record. (A new session's profile is
 * empty too, but it is not stopped: D24 sends it.)
 */
function wasDeleted(snapshot: Snapshot): boolean {
  const { standard, custom, fieldMeta } = snapshot.profile;
  return (
    snapshot.session.status === "stopped" &&
    Object.keys(standard).length === 0 &&
    Object.keys(custom).length === 0 &&
    Object.keys(fieldMeta).length === 0
  );
}

/**
 * D126: kept where an operator finds it, with the reason, and flagged on the session without
 * `needs_attention` (the conversation is fine; the dashboard is not up to date). Ids and codes
 * only in the log.
 */
async function giveUp(deps: KubriJobDeps, job: Job, reason: string): Promise<KubriJobResult> {
  deps.logger.error(
    { sessionId: job.sessionId, event: job.event, reason },
    "kubri webhook rejected for good",
  );
  await deps.queue.deadLetter("kubri-webhook", job, reason);
  await insertFlag(deps.db, {
    sessionId: job.sessionId,
    turnId: null,
    reason: KUBRI_WEBHOOK_FAILED,
    field: null,
    needsAttention: false,
  });
  return "dead";
}

/**
 * Spec §12.1 as a job (D125): read the profile as it is now, map it, send it, classify the
 * outcome. Sending the current state makes the job safe to repeat and to run out of order.
 * A transient failure throws for pg-boss to retry, except on the last attempt: then the job
 * gives up like a definitive one (dead letter with the code + flag), so it never reaches the
 * dead letter queue unflagged.
 */
export async function handleKubriWebhook(
  deps: KubriJobDeps,
  job: Job,
  attempt: JobAttempt,
): Promise<KubriJobResult> {
  const ids = { sessionId: job.sessionId, event: job.event };
  const kubri = deps.kubri;
  if (!kubri) {
    // Kept where it can be replayed once Kubri is configured; the session is not at fault.
    deps.logger.warn(ids, "kubri webhook not configured: job dead-lettered");
    await deps.queue.deadLetter("kubri-webhook", job, "not_configured");
    return "dead";
  }
  const snapshot = await loadSnapshot(deps.db, job.sessionId);
  if (!snapshot) {
    deps.logger.info(ids, "kubri webhook skipped: session gone");
    return "skipped";
  }
  if (wasDeleted(snapshot)) {
    deps.logger.info(ids, "kubri webhook skipped: data deleted");
    return "skipped";
  }
  let body;
  try {
    body = buildKubriPayload(snapshot);
  } catch (error: unknown) {
    if (!(error instanceof KubriContractError)) throw error;
    // The paths say which field is wrong (`data.country`), never its value.
    deps.logger.warn({ ...ids, paths: error.paths }, "kubri payload breaks the contract");
    return giveUp(deps, job, "contract");
  }
  const result = await kubri.send(body);
  if (result.ok) {
    deps.logger.info(
      { ...ids, ...(result.skipped ? { skipped: result.skipped } : {}) },
      "kubri webhook sent",
    );
    return "sent";
  }
  if (result.kind === "transient" && !attempt.lastAttempt) {
    deps.logger.warn(
      { ...ids, code: result.code, retryCount: attempt.retryCount },
      "kubri webhook failed: retrying",
    );
    throw new TransientJobError(result.code);
  }
  return giveUp(deps, job, result.code);
}
