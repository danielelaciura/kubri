import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ChannelAdapter, OutboundText, SendOutcome } from "../../src/channels/channel";
import { processContact } from "../../src/runtime/process-contact";
import { sendMessages, TransientSendError } from "../../src/runtime/send-messages";
import { inTransaction, lockKey } from "../../src/store/db";
import { claimNextOutbound, queueOutbound } from "../../src/store/messages";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { startTestQueue } from "./helpers/queue";
import { makeHarness, say, seedScenario, startSession, type Harness } from "./helpers/runtime";

const db = createTestDatabase();
let h: Harness;
let sessionId = "";

beforeEach(async () => {
  await resetBotSchema(db);
  const scenario = await seedScenario(db);
  h = makeHarness(scenario);
  sessionId = (await startSession(scenario)).id;
});

afterAll(async () => {
  await db.$disconnect();
});

async function queue(...bodies: string[]): Promise<string> {
  const turn = await db.turn.create({
    data: {
      sessionId,
      contactId: h.key.contactId,
      inboundMessageIds: [],
      startedAt: new Date(),
      completedAt: new Date(),
      outcome: "replied",
    },
  });
  await queueOutbound(
    db,
    bodies.map((body) => ({
      contactId: h.key.contactId,
      senderNumberId: h.key.senderNumberId,
      sessionId,
      turnId: turn.id,
      body,
      language: "it",
      stepId: null,
      questionId: null,
    })),
  );
  return turn.id;
}

const statuses = async () =>
  (await db.message.findMany({ orderBy: { ordinal: "asc" } })).map((m) => [
    m.body,
    m.status,
    m.errorCode,
  ]);

/** A harness whose channel is `channel`, with optional config overrides. */
function withChannel(channel: ChannelAdapter, config: Record<string, string> = {}): Harness {
  const other = makeHarness(h.scenario, { config });
  return { ...other, sendDeps: { ...other.sendDeps, channelFor: () => channel } };
}

describe("sendMessages", () => {
  it("sends the queued messages in order to the contact, from the number", async () => {
    await queue("uno", "due", "tre");

    await sendMessages(h.sendDeps, h.key);

    expect(h.channel.sent.map((m) => m.text)).toEqual(["uno", "due", "tre"]);
    expect(h.channel.sent[0]).toMatchObject({
      to: { externalId: h.scenario.externalId, phoneE164: h.scenario.phone },
      sender: { slug: "kubri-main", provider: "meta" },
    });
    const first = await db.message.findFirstOrThrow({ orderBy: { ordinal: "asc" } });
    expect(h.channel.sent[0]?.clientMessageId).toBe(first.id);
    expect(await statuses()).toEqual([
      ["uno", "sent", null],
      ["due", "sent", null],
      ["tre", "sent", null],
    ]);
    expect(first.providerMessageId).toBe("fake-1");
    expect(first.sentAt).not.toBeNull();
  });

  it("does nothing when there is nothing to send", async () => {
    await sendMessages(h.sendDeps, h.key);

    expect(h.channel.sent).toEqual([]);
  });

  it("puts a message back and asks for a retry after a transient failure", async () => {
    h.channel.enqueueOutcome({ ok: false, kind: "transient", code: "rate_limited" });
    await queue("uno", "due");

    await expect(sendMessages(h.sendDeps, h.key)).rejects.toThrow(TransientSendError);
    expect(await statuses()).toEqual([
      ["uno", "queued", "rate_limited"],
      ["due", "queued", null],
    ]);

    await sendMessages(h.sendDeps, h.key);
    expect(h.channel.sent.map((m) => m.text)).toEqual(["uno", "due"]);
  });

  it("treats a channel that throws as a transient failure", async () => {
    h.channel.throwOnNext(new Error("socket hang up"));
    await queue("uno");

    await expect(sendMessages(h.sendDeps, h.key)).rejects.toThrow(TransientSendError);

    expect(await statuses()).toEqual([["uno", "queued", "channel_exception"]]);
  });

  it("gives up on a channel that does not answer before the lease ends", async () => {
    const hanging: ChannelAdapter = { send: () => new Promise<SendOutcome>(() => undefined) };
    const slow = withChannel(hanging, { SEND_LEASE_MS: "400" });
    await queue("uno");

    const started = Date.now();
    await expect(sendMessages(slow.sendDeps, slow.key)).rejects.toThrow(TransientSendError);

    expect(Date.now() - started).toBeLessThan(400);
    expect(await statuses()).toEqual([["uno", "queued", "channel_timeout"]]);
  });

  it("gives up after the maximum number of attempts, as if the failure were permanent (D108)", async () => {
    for (let i = 0; i < 3; i += 1) {
      h.channel.enqueueOutcome({ ok: false, kind: "transient", code: "rate_limited" });
    }
    await queue("uno");

    await expect(sendMessages(h.sendDeps, h.key)).rejects.toThrow(TransientSendError);
    await expect(sendMessages(h.sendDeps, h.key)).rejects.toThrow(TransientSendError);
    await sendMessages(h.sendDeps, h.key);

    expect(await statuses()).toEqual([["uno", "failed", "too_many_attempts"]]);
    expect(await db.sessionFlag.findFirstOrThrow()).toMatchObject({ reason: "outbound_failed" });
  });

  it("stops the rest of the turn after a permanent failure and flags the session (spec §11.3)", async () => {
    h.channel.enqueueOutcome({ ok: false, kind: "permanent", code: "not_reachable" });
    const turnId = await queue("uno", "due");

    await sendMessages(h.sendDeps, h.key);

    expect(await statuses()).toEqual([
      ["uno", "failed", "not_reachable"],
      ["due", "failed", "skipped_after_failure"],
    ]);
    expect(h.channel.sent).toEqual([]);
    expect((await db.session.findFirstOrThrow()).status).toBe("needs_attention");
    expect(await db.sessionFlag.findFirstOrThrow()).toMatchObject({
      reason: "outbound_failed",
      needsAttention: true,
      turnId,
    });
  });

  it("sends a later turn's messages after a permanent failure of an earlier turn", async () => {
    h.channel.enqueueOutcome({ ok: false, kind: "permanent", code: "not_reachable" });
    await queue("uno", "due");
    await sendMessages(h.sendDeps, h.key);

    await queue("tre");
    await sendMessages(h.sendDeps, h.key);

    expect(h.channel.sent.map((m) => m.text)).toEqual(["tre"]);
  });

  it("still flags the session when its stored state cannot be read", async () => {
    h.channel.enqueueOutcome({ ok: false, kind: "permanent", code: "not_reachable" });
    await db.session.updateMany({ data: { engineState: { phase: "dancing" } } });
    await queue("uno");

    await sendMessages(h.sendDeps, h.key);

    expect(await db.sessionFlag.findFirstOrThrow()).toMatchObject({ reason: "outbound_failed" });
    expect((await db.session.findFirstOrThrow()).status).toBe("needs_attention");
  });

  it("leaves a message alone while another sender holds a live claim, and checks again later", async () => {
    await queue("uno");
    await db.message.updateMany({
      data: { status: "sending", leaseUntil: new Date(Date.now() + 60_000) },
    });

    await sendMessages(h.sendDeps, h.key);

    expect(h.channel.sent).toEqual([]);
    expect(h.queue.named("send-messages").at(-1)).toMatchObject({
      payload: h.key,
      options: { startAfterSeconds: 60 },
    });
  });

  it("takes over a message whose sender died (the lease expired)", async () => {
    await queue("uno");
    await db.message.updateMany({
      data: { status: "sending", leaseUntil: new Date(Date.now() - 1000), attempts: 1 },
    });

    await sendMessages(h.sendDeps, h.key);

    expect(h.channel.sent.map((m) => m.text)).toEqual(["uno"]);
  });

  it("writes nothing and reports nothing after losing the claim to another sender", async () => {
    // While this sender waits on the provider its lease expires and another sender claims
    // the message: the late permanent failure belongs to nobody any more.
    const stealing: ChannelAdapter = {
      async send(_message: OutboundText): Promise<SendOutcome> {
        const later = new Date(Date.now() + 120_000);
        const stolen = await claimNextOutbound(db, h.key, later, 60_000);
        expect(stolen).not.toBeNull();
        return { ok: false, kind: "permanent", code: "not_reachable" };
      },
    };
    const robbed = withChannel(stealing);
    await queue("uno", "due");

    await sendMessages(robbed.sendDeps, robbed.key);

    expect(await statuses()).toEqual([
      ["uno", "sending", null],
      ["due", "queued", null],
    ]);
    expect(await db.sessionFlag.count()).toBe(0);
    expect((await db.session.findFirstOrThrow()).status).toBe("active");
  });

  it("waits for a running turn before flagging the session (contact lock)", async () => {
    h.channel.enqueueOutcome({ ok: false, kind: "permanent", code: "not_reachable" });
    await queue("uno");

    let sending: Promise<void> = Promise.resolve();
    await inTransaction(
      db,
      async (tx) => {
        await lockKey(tx, `contact:${h.key.contactId}`);
        sending = sendMessages(h.sendDeps, h.key);
        await new Promise((resolve) => setTimeout(resolve, 300));
        // The message already failed; the flag waits for the turn to commit.
        expect(await statuses()).toEqual([["uno", "failed", "not_reachable"]]);
        expect(await db.sessionFlag.count()).toBe(0);
      },
      10_000,
    );
    await sending;

    expect(await db.sessionFlag.count()).toBe(1);
  });
});

describe("through the real queue (retries, spec §14)", () => {
  it("retries a transient failure with the job's retry, then sends in order", async () => {
    const runtime = await startTestQueue();
    try {
      const real = makeHarness(h.scenario, { queue: runtime.queue });
      real.channel.enqueueOutcome({ ok: false, kind: "transient", code: "rate_limited" });
      await runtime.work("send-messages", (payload) => sendMessages(real.sendDeps, payload), {
        batchSize: 1,
        pollingIntervalSeconds: 0.5,
      });
      await queue("uno", "due");

      await runtime.queue.enqueue("send-messages", real.key);

      await expect
        .poll(() => real.channel.sent.map((m) => m.text), { timeout: 20_000, interval: 200 })
        .toEqual(["uno", "due"]);
    } finally {
      await runtime.stop();
    }
  });

  it("answers a candidate end to end: receive, turn, send", async () => {
    const runtime = await startTestQueue();
    try {
      await resetBotSchema(db);
      const real = makeHarness(await seedScenario(db), { queue: runtime.queue });
      await runtime.work(
        "process-contact",
        async (p) => {
          await processContact(real.deps, p);
        },
        {
          batchSize: 1,
          pollingIntervalSeconds: 0.5,
        },
      );
      await runtime.work("send-messages", (p) => sendMessages(real.sendDeps, p), {
        batchSize: 1,
        pollingIntervalSeconds: 0.5,
      });

      await say(real, "ciao");

      await expect.poll(() => real.channel.sent.length, { timeout: 20_000, interval: 200 }).toBe(1);
      expect(real.channel.sent[0]?.text).toContain("In che lingua");
    } finally {
      await runtime.stop();
    }
  });
});
