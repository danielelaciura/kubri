import { PgBoss, fromPrisma } from "pg-boss";
import { z } from "zod";
import type { KubriEvent } from "../engine/effects";
import { toPgConnectionString } from "./connection-string";
import type { Tx } from "./db";

export const QUEUE_NAMES = [
  "process-contact",
  "send-messages",
  "report-failure",
  "kubri-webhook",
  "cv",
  "geocoding",
  "delete-contact",
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

const KUBRI_EVENTS = [
  "consents.accepted",
  "block.completed",
  "interview.completed",
  "profile.updated",
] as const satisfies readonly KubriEvent[];

/** Zod at every boundary: a payload is checked when it is enqueued and when a handler gets it. */
const PAYLOAD_SCHEMAS = {
  "process-contact": z.strictObject({ contactId: z.string(), senderNumberId: z.string() }),
  "send-messages": z.strictObject({ contactId: z.string(), senderNumberId: z.string() }),
  /** A message that failed after it was sent (D120, C7): flag its session under the lock. */
  "report-failure": z.strictObject({
    contactId: z.string(),
    sessionId: z.string(),
    turnId: z.string().nullable(),
  }),
  "kubri-webhook": z.strictObject({ sessionId: z.string(), event: z.enum(KUBRI_EVENTS) }),
  /** The turn that asked for the CV: its idempotency key (R8). */
  cv: z.strictObject({ sessionId: z.string(), turnId: z.string() }),
  geocoding: z.strictObject({ sessionId: z.string() }),
  "delete-contact": z.strictObject({ contactId: z.string() }),
} as const satisfies Record<QueueName, z.ZodType>;

export type JobPayloads = { [Q in QueueName]: z.infer<(typeof PAYLOAD_SCHEMAS)[Q]> };

function parsePayload<Q extends QueueName>(name: Q, data: unknown): JobPayloads[Q] {
  return PAYLOAD_SCHEMAS[name].parse(data) as JobPayloads[Q];
}

export interface EnqueueOptions {
  /** Seconds before the job can run. */
  readonly startAfterSeconds?: number;
}

/** What the runtime needs to enqueue: easy to fake in unit tests. */
export interface JobQueue {
  /** With `tx`, the job exists only if that transaction commits (D103). */
  enqueue<Q extends QueueName>(
    name: Q,
    payload: JobPayloads[Q],
    options?: EnqueueOptions,
    tx?: Tx,
  ): Promise<void>;
  /**
   * A job that can never succeed (a definitive error): straight to the queue's dead letter
   * queue with the reason, where an operator finds it (D126). It is never retried.
   */
  deadLetter<Q extends QueueName>(name: Q, payload: JobPayloads[Q], reason: string): Promise<void>;
}

export interface QueueSettings {
  /**
   * Direct / session (5432) connection: pg-boss does not work behind the transaction pooler
   * (QUEUE_DATABASE_URL). A Prisma `?schema=` parameter is removed here.
   */
  readonly connectionString: string;
  /** pg-boss installs and keeps its tables here, never in public (CLAUDE.md: `bot_queue`). */
  readonly schema: string;
  /** Retries of a failed job before it moves to its dead letter queue (default 5). */
  readonly retryLimit?: number;
  /** Per queue, over `retryLimit`: the worker raises send-messages' (sendRetryLimit, D108). */
  readonly retryLimits?: Partial<Record<QueueName, number>>;
  readonly retryDelaySeconds?: number;
  /** pg-boss reports connection problems as events; without a listener they would crash. */
  readonly onError?: (error: Error) => void;
  /**
   * How long stop() waits for the handlers still running before it closes (default 10 s). The
   * worker sets it to its longest job (workerStopTimeoutMs): the hosting platform's grace
   * period on shutdown must be at least as long.
   */
  readonly stopTimeoutMs?: number;
  /** Every failed job, retried or not: ids and error name only (CLAUDE.md, privacy rule 3). */
  readonly onJobFailed?: (failure: JobFailure) => void;
}

export interface JobFailure {
  readonly queue: QueueName;
  readonly jobId: string;
  readonly errorName: string;
  /** Prisma (P2002), Postgres (23505) or runtime (channel_timeout) code, when there is one. */
  readonly code?: string;
}

export interface WorkOptions {
  readonly batchSize: number;
  /** pg-boss polls the queue; tests lower it to keep them fast (minimum 0.5). */
  readonly pollingIntervalSeconds?: number;
}

/** Which run of a job a handler holds: pg-boss counts the retries. */
export interface JobAttempt {
  /** 0 on the first run. */
  readonly retryCount: number;
  /**
   * No retry is left after this run (the job's own retry limit, set when it was created): a
   * handler that wants to do something before the job goes to its dead letter queue does it
   * now (the cv job D131, kubri-webhook D126).
   */
  readonly lastAttempt: boolean;
}

export type JobHandler<Q extends QueueName> = (
  payload: JobPayloads[Q],
  attempt: JobAttempt,
) => Promise<void>;

export interface QueueRuntime {
  readonly queue: JobQueue;
  start(): Promise<void>;
  stop(): Promise<void>;
  work<Q extends QueueName>(name: Q, handler: JobHandler<Q>, options: WorkOptions): Promise<void>;
  /** The retries a new job of the queue gets, as configured here. */
  retryLimitOf(name: QueueName): number;
  /** Tests: empties every queue. */
  purge(): Promise<void>;
}

const dead = (name: string): string => `${name}-dead`;

/** What PgBoss is built with: node-postgres would not understand Prisma's `schema` parameter. */
export function bossOptions(settings: Pick<QueueSettings, "connectionString" | "schema">): {
  connectionString: string;
  schema: string;
} {
  return {
    connectionString: toPgConnectionString(settings.connectionString),
    schema: settings.schema,
  };
}

export function createQueueRuntime(settings: QueueSettings): QueueRuntime {
  const boss = new PgBoss(bossOptions(settings));
  const retryLimitOf = (name: QueueName): number =>
    settings.retryLimits?.[name] ?? settings.retryLimit ?? 5;
  boss.on("error", (error: Error) => settings.onError?.(error));

  const queue: JobQueue = {
    async enqueue(name, payload, options = {}, tx) {
      await boss.send(name, parsePayload(name, payload), {
        ...(options.startAfterSeconds === undefined
          ? {}
          : { startAfter: options.startAfterSeconds }),
        // pg-boss's own Prisma adapter: the insert runs on the transaction's connection, through
        // $queryRawUnsafe with positional values, so a rollback discards the job (D103).
        ...(tx ? { db: fromPrisma(tx) } : {}),
      });
    },
    async deadLetter(name, payload, reason) {
      await boss.send(dead(name), { ...parsePayload(name, payload), reason });
    },
  };

  return {
    queue,
    async start() {
      await boss.start();
      for (const name of QUEUE_NAMES) {
        const options = {
          deadLetter: dead(name),
          retryLimit: retryLimitOf(name),
          retryDelay: settings.retryDelaySeconds ?? 10,
          retryBackoff: true,
        };
        // The dead letter queue must exist before the queue that points at it.
        await boss.createQueue(dead(name));
        await boss.createQueue(name, options);
        // createQueue leaves an existing queue as it was: a changed setting applies on restart.
        await boss.updateQueue(name, options);
      }
    },
    async stop() {
      // Stops fetching, waits for the running handlers, then closes the pool.
      await boss.stop({ graceful: true, timeout: settings.stopTimeoutMs ?? 10_000 });
    },
    async work(name, handler, options) {
      await boss.work(
        name,
        {
          batchSize: options.batchSize,
          // Each job is settled on its own: a failure retries that job alone, so it never uses up
          // the retries of the others in its batch (send-messages counts on them, D108).
          perJobResults: true,
          // Each job's own retry limit: the one it was created with, which a restart with a
          // changed setting does not touch (updateQueue only affects new jobs).
          includeMetadata: true,
          ...(options.pollingIntervalSeconds === undefined
            ? {}
            : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
        },
        async (jobs) => {
          const results = await Promise.allSettled(
            jobs.map((job) =>
              handler(parsePayload(name, job.data), {
                retryCount: job.retryCount,
                lastAttempt: job.retryCount >= job.retryLimit,
              }),
            ),
          );
          return results.map((result, i) => {
            const id = jobs[i]?.id ?? "";
            if (result.status === "fulfilled") return { id, status: "completed" as const };
            const output = failureOutput(result.reason);
            settings.onJobFailed?.({
              queue: name,
              jobId: id,
              errorName: output.name,
              ...(output.code === undefined ? {} : { code: output.code }),
            });
            return { id, status: "failed" as const, output };
          });
        },
      );
    },
    retryLimitOf,
    async purge() {
      await boss.deleteAllJobs();
    },
  };
}

/**
 * What pg-boss stores on a failed job: the error's name and code, never its message. Messages
 * can carry values (a Prisma error quotes the failing query's data), and the job table is kept
 * for days.
 */
export function failureOutput(reason: unknown): { name: string; code?: string } {
  if (!(reason instanceof Error)) return { name: "unknown" };
  const code = "code" in reason && typeof reason.code === "string" ? reason.code : undefined;
  return code === undefined ? { name: reason.name } : { name: reason.name, code };
}
