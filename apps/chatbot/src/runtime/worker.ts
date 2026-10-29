import type { Logger } from "pino";
import type { QueueRuntime, QueueSettings } from "../store/queue";
import { requireQueueDatabaseUrl, sendRetryLimit, type RuntimeConfig } from "./config";
import { processContact, type RuntimeDeps } from "./process-contact";
import { sendMessages, type SendDeps } from "./send-messages";

export interface WorkerDeps {
  readonly runtime: RuntimeDeps;
  readonly send: SendDeps;
  readonly queue: QueueRuntime;
  /** Tests lower it; production leaves the pg-boss default. */
  readonly pollingIntervalSeconds?: number;
}

/**
 * Every process that starts pg-boss uses these (the worker, `inbound send`, plan 09's web
 * process): start() re-applies the queues' options, so different settings would undo each
 * other's retry limits.
 *
 * The direct connection (never the transaction pooler, and never
 * DATABASE_URL in production), enough retries for send-messages (D108), and connection errors
 * logged by name and SQLSTATE only, since their messages can carry the user or the host.
 */
export function workerQueueSettings(config: RuntimeConfig, logger: Logger): QueueSettings {
  return {
    connectionString: requireQueueDatabaseUrl(config),
    schema: config.queueSchema,
    retryLimits: { "send-messages": sendRetryLimit(config) },
    onError: (error) => {
      const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
      logger.error({ errorName: error.name, ...(code ? { code } : {}) }, "queue error");
    },
    // pg-boss retries the job (or moves it to its dead letter queue): this is the trace of it.
    onJobFailed: (failure) => {
      logger.warn(failure, "job failed");
    },
  };
}

/**
 * Starts pg-boss and registers the handlers of this plan: `process-contact` and
 * `send-messages`. The other queues (kubri-webhook, cv, geocoding, delete-contact) exist and
 * receive jobs; their handlers are plans 10 and 11's.
 *
 * Both handlers are idempotent, so a retried job is harmless: process-contact finds the burst
 * already processed (or still locked by the turn that holds it), send-messages finds the
 * messages already sent or claimed. Each job of a batch is settled on its own (queue.work).
 */
export async function startWorker(deps: WorkerDeps): Promise<void> {
  const { config } = deps.runtime;
  const retries = deps.queue.retryLimitOf("send-messages");
  if (retries < config.sendMaxAttempts - 1) {
    throw new Error(
      `send-messages retries (${String(retries)}) are fewer than SEND_MAX_ATTEMPTS - 1 ` +
        `(${String(config.sendMaxAttempts - 1)}): a job would dead-letter while its message is queued.`,
    );
  }
  await deps.queue.start();
  const options = {
    batchSize: config.workerBatchSize,
    ...(deps.pollingIntervalSeconds === undefined
      ? {}
      : { pollingIntervalSeconds: deps.pollingIntervalSeconds }),
  };
  await deps.queue.work(
    "process-contact",
    async (payload) => {
      await processContact(deps.runtime, payload);
    },
    options,
  );
  await deps.queue.work("send-messages", (payload) => sendMessages(deps.send, payload), options);
}
