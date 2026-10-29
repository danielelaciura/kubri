import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "../../../src/runtime/config";
import { MemoryJobQueue } from "../../../src/runtime/memory-queue";
import type { RuntimeDeps } from "../../../src/runtime/process-contact";
import type { SendDeps } from "../../../src/runtime/send-messages";
import { startWorker, workerQueueSettings } from "../../../src/runtime/worker";
import type { Database } from "../../../src/store/db";
import type { QueueName, QueueRuntime, WorkOptions } from "../../../src/store/queue";

const SECRET = "test-consent-hash-secret-0123456789abcdef";
const QUEUE_URL = "postgresql://u:p@db.example.com:5432/postgres";

function fakeQueue(retryLimit: number): QueueRuntime & {
  readonly registered: { name: QueueName; options: WorkOptions }[];
  started: boolean;
} {
  const registered: { name: QueueName; options: WorkOptions }[] = [];
  const runtime = {
    queue: new MemoryJobQueue(),
    registered,
    started: false,
    start() {
      runtime.started = true;
      return Promise.resolve();
    },
    stop: () => Promise.resolve(),
    work(name: QueueName, _handler: unknown, options: WorkOptions) {
      registered.push({ name, options });
      return Promise.resolve();
    },
    retryLimitOf: () => retryLimit,
    purge: () => Promise.resolve(),
  };
  return runtime;
}

function depsFor(env: Record<string, string>, queue: QueueRuntime) {
  const config = parseRuntimeConfig(env);
  const logger = pino({ level: "silent" });
  const db = {} as Database; // never reached: the handlers do not run here
  const runtime = { db, config, logger, queue: queue.queue } as unknown as RuntimeDeps;
  const send = { db, config, logger, queue: queue.queue } as unknown as SendDeps;
  return { runtime, send, queue };
}

describe("startWorker", () => {
  it("registers process-contact and send-messages with the configured batch size", async () => {
    const queue = fakeQueue(5);

    await startWorker(depsFor({ WORKER_BATCH_SIZE: "3" }, queue));

    expect(queue.started).toBe(true);
    expect(queue.registered).toEqual([
      { name: "process-contact", options: { batchSize: 3 } },
      { name: "send-messages", options: { batchSize: 3 } },
    ]);
  });

  it("refuses a queue that would dead-letter a send while its message is still queued", async () => {
    const queue = fakeQueue(3);

    await expect(startWorker(depsFor({ SEND_MAX_ATTEMPTS: "5" }, queue))).rejects.toThrow(
      /send-messages retries \(3\) are fewer than SEND_MAX_ATTEMPTS - 1 \(4\)/,
    );
    expect(queue.registered).toEqual([]);
  });
});

describe("workerQueueSettings", () => {
  const config = parseRuntimeConfig({
    QUEUE_DATABASE_URL: QUEUE_URL,
    CONSENT_HASH_SECRET: SECRET,
    SEND_MAX_ATTEMPTS: "9",
  });

  it("uses the direct connection and gives send-messages enough retries", () => {
    const settings = workerQueueSettings(config, pino({ level: "silent" }));

    expect(settings.connectionString).toBe(QUEUE_URL);
    expect(settings.schema).toBe("bot_queue");
    expect(settings.retryLimits).toEqual({ "send-messages": 8 });
  });

  it("refuses to start without QUEUE_DATABASE_URL outside development and test", () => {
    expect(() =>
      workerQueueSettings(
        parseRuntimeConfig({ NODE_ENV: "production", DATABASE_URL: "postgresql://x/db" }),
        pino({ level: "silent" }),
      ),
    ).toThrow(/QUEUE_DATABASE_URL is not set/);
  });

  it("logs a queue error by name and code only: its message may carry the connection", () => {
    const lines: string[] = [];
    const logger = pino({ level: "info" }, { write: (line: string) => lines.push(line) });
    const settings = workerQueueSettings(config, logger);
    const error = Object.assign(new Error("password authentication failed for user secretuser"), {
      code: "28P01",
    });

    settings.onError?.(error);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: 50,
      errorName: "Error",
      code: "28P01",
      msg: "queue error",
    });
    expect(lines[0]).not.toContain("secretuser");
  });
});
