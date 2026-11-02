import type { Logger } from "pino";
import type { KubriClient } from "../integrations/kubri/client";
import type { QueueRuntime, QueueSettings } from "../store/queue";
import {
  requireQueueDatabaseUrl,
  sendRetryLimit,
  workerStopTimeoutMs,
  type RuntimeConfig,
} from "./config";
import { handleCv } from "./jobs/cv";
import { handleGeocoding } from "./jobs/geocoding";
import { handleKubriWebhook } from "./jobs/kubri-webhook";
import { reportOutboundFailure } from "./outbound-failure";
import { processContact, type RuntimeDeps } from "./process-contact";
import { sendMessages, type SendDeps } from "./send-messages";

export interface WorkerDeps {
  readonly runtime: RuntimeDeps;
  readonly send: SendDeps;
  readonly queue: QueueRuntime;
  /**
   * The Kubri dashboard (plan 10). Absent or null: not configured, which only development
   * allows (R9); kubri-webhook jobs then go to the dead letter queue (`not_configured`).
   */
  readonly kubri?: KubriClient | null;
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
    // A turn interrupted mid-transaction rolls back and runs again, but a send would go twice.
    stopTimeoutMs: workerStopTimeoutMs(config),
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
 * Starts pg-boss and registers the handlers of plans 08, 09 and 10: `process-contact`,
 * `send-messages`, `report-failure`, `kubri-webhook`, `cv` and `geocoding`. `delete-contact`
 * exists and receives jobs; its handler is plan 11's.
 *
 * The handlers are idempotent, so a retried job is harmless: process-contact finds the burst
 * already processed (or still locked by the turn that holds it), send-messages finds the
 * messages already sent or claimed, kubri-webhook sends the current profile again, cv finds
 * the CV of its turn already queued. Each job of a batch is settled on its own (queue.work).
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
  // One at a time: each may wait for a whole turn to release the contact's lock (D120).
  await deps.queue.work("report-failure", (payload) => reportOutboundFailure(deps.send, payload), {
    ...options,
    batchSize: 1,
  });
  // Plan 10, one at a time (R3, R9): workerPoolSize counts two connections for each.
  const { db, logger, resolver, now } = deps.runtime;
  const oneByOne = { ...options, batchSize: 1 };
  await deps.queue.work(
    "kubri-webhook",
    async (payload) => {
      await handleKubriWebhook(
        { db, logger, queue: deps.queue.queue, kubri: deps.kubri ?? null },
        payload,
      );
    },
    oneByOne,
  );
  await deps.queue.work(
    "cv",
    async (payload, attempt) => {
      await handleCv(
        {
          db,
          config,
          logger,
          queue: deps.queue.queue,
          resolver,
          channelFor: deps.send.channelFor,
          now,
        },
        payload,
        attempt,
      );
    },
    oneByOne,
  );
  await deps.queue.work("geocoding", (payload) => handleGeocoding({ logger }, payload), oneByOne);
}
