import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startWorker } from "../../src/runtime/worker";
import type { QueueRuntime } from "../../src/store/queue";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { startTestQueue } from "./helpers/queue";
import { FakeKubriClient } from "../../src/integrations/kubri/client";
import { insertTurn } from "../../src/store/turns";
import { makeHarness, say, seedScenario, startSession } from "./helpers/runtime";

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

  it("runs plan 10's jobs: the CV reaches the channel as a document, the profile reaches Kubri", async () => {
    const scenario = await seedScenario(db);
    const h = makeHarness(scenario, { queue: queueRuntime.queue });
    const kubri = new FakeKubriClient();
    await startWorker({
      runtime: h.deps,
      send: h.sendDeps,
      queue: queueRuntime,
      kubri,
      pollingIntervalSeconds: 0.5,
    });
    const session = await startSession(scenario);
    const turnId = "3d7a9e52-8c41-4f0b-a6d2-1e9b7c5f4a80";
    await insertTurn(db, {
      id: turnId,
      sessionId: session.id,
      contactId: scenario.contactId,
      inboundMessageIds: [],
      startedAt: new Date(),
      completedAt: new Date(),
      outcome: "replied",
    });

    await queueRuntime.queue.enqueue("cv", { sessionId: session.id, turnId });
    await queueRuntime.queue.enqueue("kubri-webhook", {
      sessionId: session.id,
      event: "consents.accepted",
    });

    await expect.poll(() => h.channel.sent.length, { timeout: 20_000, interval: 250 }).toBe(1);
    expect(h.channel.sent[0]?.document).toEqual({ mediaId: "fake-media-1", filename: "CV.pdf" });
    await expect.poll(() => kubri.sent.length, { timeout: 20_000, interval: 250 }).toBe(1);
  });
});
