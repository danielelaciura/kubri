import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inTransaction } from "../../src/store/db";
import type { QueueRuntime } from "../../src/store/queue";
import { createTestDatabase } from "./helpers/database";
import { TEST_QUEUE_SCHEMA, countJobs, peekQueue, startTestQueue } from "./helpers/queue";

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
});
