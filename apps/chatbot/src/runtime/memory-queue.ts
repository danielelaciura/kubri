import type { EnqueueOptions, JobPayloads, JobQueue, QueueName } from "../store/queue";
import type { Tx } from "../store/db";

export interface EnqueuedJob {
  readonly name: QueueName;
  readonly payload: unknown;
  readonly options: EnqueueOptions;
  readonly inTransaction: boolean;
}

/** For unit and integration tests that only need to see what would be enqueued. */
export class MemoryJobQueue implements JobQueue {
  readonly jobs: EnqueuedJob[] = [];

  enqueue<Q extends QueueName>(
    name: Q,
    payload: JobPayloads[Q],
    options: EnqueueOptions = {},
    tx?: Tx,
  ): Promise<void> {
    this.jobs.push({ name, payload, options, inTransaction: tx !== undefined });
    return Promise.resolve();
  }

  named(name: QueueName): EnqueuedJob[] {
    return this.jobs.filter((job) => job.name === name);
  }
}
