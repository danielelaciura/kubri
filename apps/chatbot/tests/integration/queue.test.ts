import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inTransaction } from "../../src/store/db";
import type { QueueRuntime } from "../../src/store/queue";
import { createTestDatabase } from "./helpers/database";
import {
  TEST_QUEUE_SCHEMA,
  countJobs,
  retryLimits,
  peekQueue,
  startTestQueue,
} from "./helpers/queue";

const db = createTestDatabase();
let runtime: QueueRuntime;

interface SchemaObject {
  kind: string;
  name: string;
}

/** Tables, functions and types of a schema: what an installer could leave behind. */
async function objectsIn(schema: string): Promise<SchemaObject[]> {
  return db.$queryRaw<SchemaObject[]>`
    SELECT 'relation' AS kind, c.relname::text AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${schema}
    UNION ALL
    SELECT 'function', p.proname::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${schema}
    UNION ALL
    SELECT 'type', t.typname::text
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = ${schema}
    ORDER BY 1, 2
  `;
}

let publicBefore: SchemaObject[];

beforeAll(async () => {
  // Install from scratch, so the schema check below sees everything pg-boss creates.
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${TEST_QUEUE_SCHEMA} CASCADE`);
  publicBefore = await objectsIn("public");
  runtime = await startTestQueue();
});

beforeEach(async () => {
  await runtime.purge();
});

afterAll(async () => {
  await runtime.stop();
  await db.$disconnect();
});

const PAYLOAD = { contactId: "c1", senderNumberId: "s1" };

describe("installation", () => {
  it("creates pg-boss in its own schema and nothing in public", async () => {
    const tables = await db.$queryRaw<{ schema: string }[]>`
      SELECT table_schema AS schema FROM information_schema.tables WHERE table_name = 'job'
    `;

    expect(tables.map((t) => t.schema)).toEqual([TEST_QUEUE_SCHEMA]);
    expect(await objectsIn("public")).toEqual(publicBefore);
  });
});

describe("transactional enqueue (D103)", () => {
  it("enqueues outside a transaction", async () => {
    await runtime.queue.enqueue("send-messages", PAYLOAD);

    expect((await peekQueue(db, "send-messages")).map((j) => j.data)).toEqual([PAYLOAD]);
  });

  it("creates the job when the transaction commits", async () => {
    await inTransaction(
      db,
      async (tx) => {
        await runtime.queue.enqueue("send-messages", PAYLOAD, {}, tx);
      },
      10_000,
    );

    expect((await peekQueue(db, "send-messages")).map((j) => j.data)).toEqual([PAYLOAD]);
  });

  it("does not create the job when the transaction rolls back", async () => {
    await expect(
      inTransaction(
        db,
        async (tx) => {
          await runtime.queue.enqueue("send-messages", PAYLOAD, {}, tx);
          throw new Error("boom");
        },
        10_000,
      ),
    ).rejects.toThrow("boom");

    expect(await countJobs(db, "send-messages")).toBe(0);
  });

  it("writes the job inside the transaction: invisible to others until the commit", async () => {
    await inTransaction(
      db,
      async (tx) => {
        await runtime.queue.enqueue("send-messages", PAYLOAD, {}, tx);
        // Another connection does not see it yet; the transaction itself does.
        expect(await countJobs(db, "send-messages")).toBe(0);
        const inside = await tx.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM ${TEST_QUEUE_SCHEMA}.job WHERE name = $1`,
          "send-messages",
        );
        expect(inside[0]?.n).toBe(1);
      },
      10_000,
    );

    expect(await countJobs(db, "send-messages")).toBe(1);
  });

  it("delays a job with startAfter", async () => {
    await runtime.queue.enqueue("process-contact", PAYLOAD, { startAfterSeconds: 60 });

    expect(await peekQueue(db, "process-contact")).toEqual([]);
    expect(await countJobs(db, "process-contact")).toBe(1);
  });

  it("refuses a payload that does not match its queue", async () => {
    await expect(
      runtime.queue.enqueue("send-messages", { contactId: "c1" } as never),
    ).rejects.toThrow();
    expect(await countJobs(db, "send-messages")).toBe(0);
  });
});

describe("workers", () => {
  it("runs a registered handler with the parsed payload", async () => {
    const seen: unknown[] = [];
    await runtime.work(
      "send-messages",
      (payload) => {
        seen.push(payload);
        return Promise.resolve();
      },
      { batchSize: 1, pollingIntervalSeconds: 0.5 },
    );

    await runtime.queue.enqueue("send-messages", PAYLOAD);

    await expect.poll(() => seen, { timeout: 15_000, interval: 200 }).toEqual([PAYLOAD]);
  });

  it("moves a job that keeps failing to the dead letter queue", async () => {
    await runtime.work("kubri-webhook", () => Promise.reject(new Error("down")), {
      batchSize: 1,
      pollingIntervalSeconds: 0.5,
    });

    await runtime.queue.enqueue("kubri-webhook", { sessionId: "s", event: "consents.accepted" });

    await expect
      .poll(() => countJobs(db, "kubri-webhook-dead"), { timeout: 20_000, interval: 300 })
      .toBe(1);
  });

  it("retries only the job that failed: the others of its batch complete", async () => {
    const runs = new Map<string, number>();
    await runtime.work(
      "geocoding",
      ({ sessionId }) => {
        runs.set(sessionId, (runs.get(sessionId) ?? 0) + 1);
        return sessionId === "bad" ? Promise.reject(new Error("down")) : Promise.resolve();
      },
      { batchSize: 3, pollingIntervalSeconds: 0.5 },
    );

    for (const sessionId of ["ok-1", "bad", "ok-2"]) {
      await runtime.queue.enqueue("geocoding", { sessionId });
    }

    await expect
      .poll(() => countJobs(db, "geocoding-dead"), { timeout: 20_000, interval: 300 })
      .toBe(1);
    // retryLimit 1: the failing job ran twice, its neighbours once each.
    expect(Object.fromEntries(runs)).toEqual({ "ok-1": 1, bad: 2, "ok-2": 1 });
  });
});

describe("failed jobs", () => {
  it("reports each failure with ids only and stores no error message", async () => {
    const failures: unknown[] = [];
    const reporting = await startTestQueue({
      retryLimit: 0,
      onJobFailed: (failure) => failures.push(failure),
    });
    try {
      await reporting.work(
        "cv",
        () => Promise.reject(Object.assign(new Error("value Mariam Benali"), { code: "P2002" })),
        { batchSize: 1, pollingIntervalSeconds: 0.5 },
      );
      await reporting.queue.enqueue("cv", { sessionId: "s1" });

      await expect.poll(() => failures.length, { timeout: 15_000, interval: 200 }).toBe(1);
      expect(failures[0]).toEqual({
        queue: "cv",
        jobId: expect.any(String) as string,
        errorName: "Error",
        code: "P2002",
      });
      const rows = await db.$queryRawUnsafe<{ output: unknown }[]>(
        `SELECT output FROM ${TEST_QUEUE_SCHEMA}.job WHERE name = 'cv'`,
      );
      expect(rows.map((r) => r.output)).toEqual([{ name: "Error", code: "P2002" }]);
    } finally {
      await reporting.stop();
    }
  });
});

describe("retry limits", () => {
  it("gives a queue its own limit, and a restart applies a changed one", async () => {
    const first = await startTestQueue({ retryLimits: { "send-messages": 7 } });
    await first.queue.enqueue("send-messages", PAYLOAD);
    expect(await retryLimits(db, "send-messages")).toEqual({ queue: 7, job: 7 });
    await first.stop();

    const second = await startTestQueue({ retryLimits: { "send-messages": 4 } });
    await second.queue.enqueue("send-messages", PAYLOAD);
    await second.queue.enqueue("cv", { sessionId: "s" });
    await second.stop();

    expect(await retryLimits(db, "send-messages")).toEqual({ queue: 4, job: 4 });
    expect(await retryLimits(db, "cv")).toEqual({ queue: 1, job: 1 });
    expect(second.retryLimitOf("send-messages")).toBe(4);
    expect(second.retryLimitOf("cv")).toBe(1);
  });
});
