import type { EnqueueOptions, JobPayloads, JobQueue, QueueName } from "../store/queue";
import type { Tx } from "../store/db";

export interface EnqueuedJob {
  readonly name: QueueName;
  readonly payload: unknown;
  readonly options: EnqueueOptions;
  readonly inTransaction: boolean;
}

export interface DeadLetter {
  readonly name: QueueName;
  readonly payload: unknown;
  readonly reason: string;
}

/** For unit and integration tests that only need to see what would be enqueued. */
export class MemoryJobQueue implements JobQueue {
  readonly jobs: EnqueuedJob[] = [];
  readonly deadLetters: DeadLetter[] = [];

  enqueue<Q extends QueueName>(
    name: Q,
    payload: JobPayloads[Q],
    options: EnqueueOptions = {},
    tx?: Tx,
  ): Promise<void> {
    this.jobs.push({ name, payload, options, inTransaction: tx !== undefined });
    return Promise.resolve();
  }

  deadLetter<Q extends QueueName>(name: Q, payload: JobPayloads[Q], reason: string): Promise<void> {
    this.deadLetters.push({ name, payload, reason });
    return Promise.resolve();
  }

  named(name: QueueName): EnqueuedJob[] {
    return this.jobs.filter((job) => job.name === name);
  }
}
