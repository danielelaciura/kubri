import { PgBoss, fromPrisma } from "pg-boss";
import { z } from "zod";
import type { KubriEvent } from "../engine/effects";
import { toPgConnectionString } from "./connection-string";
import type { Tx } from "./db";

export const QUEUE_NAMES = [
  "process-contact",
  "send-messages",
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
  "kubri-webhook": z.strictObject({ sessionId: z.string(), event: z.enum(KUBRI_EVENTS) }),
  cv: z.strictObject({ sessionId: z.string() }),
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
}

export interface QueueSettings {
  /**
   * Direct / session (5432) connection: pg-boss does not work behind the transaction pooler
   * (QUEUE_DATABASE_URL). A Prisma `?schema=` parameter is removed here.
   */
  readonly connectionString: string;
  /** pg-boss installs and keeps its tables here, never in public (CLAUDE.md: `bot_queue`). */
  readonly schema: string;
  readonly retryLimit?: number;
  readonly retryDelaySeconds?: number;
  /** pg-boss reports connection problems as events; without a listener they would crash. */
  readonly onError?: (error: Error) => void;
}

export interface WorkOptions {
  readonly batchSize: number;
  /** pg-boss polls the queue; tests lower it to keep them fast (minimum 0.5). */
  readonly pollingIntervalSeconds?: number;
}

export interface QueueRuntime {
  readonly queue: JobQueue;
  start(): Promise<void>;
  stop(): Promise<void>;
  work<Q extends QueueName>(
    name: Q,
    handler: (payload: JobPayloads[Q]) => Promise<void>,
    options: WorkOptions,
  ): Promise<void>;
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
  };

  return {
    queue,
    async start() {
      await boss.start();
      for (const name of QUEUE_NAMES) {
        // The dead letter queue must exist before the queue that points at it.
        await boss.createQueue(dead(name));
        await boss.createQueue(name, {
          deadLetter: dead(name),
          retryLimit: settings.retryLimit ?? 5,
          retryDelay: settings.retryDelaySeconds ?? 10,
          retryBackoff: true,
        });
      }
    },
    async stop() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
    async work(name, handler, options) {
      await boss.work(
        name,
        {
          batchSize: options.batchSize,
          ...(options.pollingIntervalSeconds === undefined
            ? {}
            : { pollingIntervalSeconds: options.pollingIntervalSeconds }),
        },
        async (jobs) => {
          const results = await Promise.allSettled(
            jobs.map((job) => handler(parsePayload(name, job.data))),
          );
          const failed = results.find((r) => r.status === "rejected");
          // One failing job fails the batch: handlers are idempotent, the others run again.
          if (failed) throw failed.reason;
        },
      );
    },
    async purge() {
      await boss.deleteAllJobs();
    },
  };
}
