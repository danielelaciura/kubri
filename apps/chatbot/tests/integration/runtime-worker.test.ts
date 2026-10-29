import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startWorker } from "../../src/runtime/worker";
import type { QueueRuntime } from "../../src/store/queue";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { startTestQueue } from "./helpers/queue";
import { makeHarness, say, seedScenario } from "./helpers/runtime";

const db = createTestDatabase();
let queueRuntime: QueueRuntime;

/** testConfig has SEND_MAX_ATTEMPTS=3: send-messages needs at least 2 retries. */
const startWorkerQueue = () => startTestQueue({ retryLimits: { "send-messages": 2 } });

beforeAll(async () => {
  queueRuntime = await startWorkerQueue();
});

beforeEach(async () => {
  await resetBotSchema(db);
  await queueRuntime.purge();
});

afterEach(async () => {
  // A fresh pg-boss per test: the workers registered by startWorker stop with it.
  await queueRuntime.stop();
  queueRuntime = await startWorkerQueue();
});

afterAll(async () => {
  await queueRuntime.stop();
  await db.$disconnect();
});

describe("startWorker", () => {
  it("turns an inbound message into a welcome on the channel, through the real queue", async () => {
    const h = makeHarness(await seedScenario(db), { queue: queueRuntime.queue });
    await startWorker({
      runtime: h.deps,
      send: h.sendDeps,
      queue: queueRuntime,
      pollingIntervalSeconds: 0.5,
    });

    await say(h, "ciao");

    await expect.poll(() => h.channel.sent.length, { timeout: 20_000, interval: 250 }).toBe(1);
    expect(h.channel.sent[0]?.text).toContain("In che lingua");
    // The channel has it before the outcome is written: wait for the commit.
    await expect
      .poll(
        async () =>
          (await db.message.findFirstOrThrow({ where: { direction: "outbound" } })).status,
        { timeout: 10_000, interval: 100 },
      )
      .toBe("sent");
  });

  it("answers the next message of the same contact too, in order", async () => {
    const h = makeHarness(await seedScenario(db), { queue: queueRuntime.queue });
    await startWorker({
      runtime: h.deps,
      send: h.sendDeps,
      queue: queueRuntime,
      pollingIntervalSeconds: 0.5,
    });

    await say(h, "ciao");
    await expect.poll(() => h.channel.sent.length, { timeout: 20_000, interval: 250 }).toBe(1);
    await say(h, "italiano");

    await expect
      .poll(() => h.channel.sent.length, { timeout: 20_000, interval: 250 })
      .toBeGreaterThan(1);
    const ordered = await db.message.findMany({
      where: { direction: "outbound" },
      orderBy: { ordinal: "asc" },
    });
    await expect
      .poll(() => h.channel.sent.length, { timeout: 20_000, interval: 250 })
      .toBe(ordered.length);
    expect(h.channel.sent.map((m) => m.text)).toEqual(ordered.map((m) => m.body));
  });
});
