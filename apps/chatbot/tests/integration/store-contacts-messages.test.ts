import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { inTransaction } from "../../src/store/db";
import { recordOptOut, registerInbound, upsertContact } from "../../src/store/contacts";
import {
  claimNextOutbound,
  finishSend,
  insertInboundMessage,
  queueOutbound,
  receivedBurst,
  recentRedactedHistory,
  markInboundProcessed,
  type MessageKind,
} from "../../src/store/messages";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedRegistry } from "./helpers/registry";

const db = createTestDatabase();
let senderId = "";
let contactId = "";

beforeEach(async () => {
  await resetBotSchema(db);
  senderId = (await seedRegistry(db)).sender.id;
  contactId = (
    await upsertContact(db, {
      channel: "whatsapp",
      externalId: "393331112233",
      phoneE164: "+393331112233",
    })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

const inbound = (
  providerMessageId: string,
  body: string | null = "ciao",
  type: MessageKind = "text",
) => ({
  contactId,
  senderNumberId: senderId,
  providerMessageId,
  type,
  body,
  payloadRaw: { id: providerMessageId },
});

describe("contacts", () => {
  it("upserts by channel and external id, refreshing the phone", async () => {
    const again = await upsertContact(db, {
      channel: "whatsapp",
      externalId: "393331112233",
      phoneE164: "+393339999999",
    });

    expect(again.id).toBe(contactId);
    expect(await db.contact.count()).toBe(1);
    expect((await db.contact.findUniqueOrThrow({ where: { id: contactId } })).phoneE164).toBe(
      "+393339999999",
    );
  });

  it("tracks the 24 hour window and re-opts-in a contact that had opted out (D105)", async () => {
    const t1 = new Date("2026-10-24T10:00:00Z");
    const t2 = new Date("2026-10-24T11:00:00Z");
    await registerInbound(db, { contactId, senderNumberId: senderId, at: t1 });
    await recordOptOut(db, contactId, senderId, t1);
    expect((await db.contactChannelState.findFirstOrThrow()).optInStatus).toBe("opted_out");

    await registerInbound(db, { contactId, senderNumberId: senderId, at: t2 });

    expect(await db.contactChannelState.findFirstOrThrow()).toMatchObject({
      optInStatus: "opted_in",
      optInSource: "inbound",
      lastInboundAt: t2,
      optOutAt: t1,
    });
  });

  it("records an opt-out for a contact with no state yet", async () => {
    await recordOptOut(db, contactId, senderId, new Date("2026-10-24T10:00:00Z"));

    expect((await db.contactChannelState.findFirstOrThrow()).optInStatus).toBe("opted_out");
  });
});

describe("inbound messages", () => {
  it("deduplicates on the provider's message id", async () => {
    expect(await insertInboundMessage(db, inbound("wamid.1"))).toEqual({ created: true });
    expect(await insertInboundMessage(db, inbound("wamid.1"))).toEqual({ created: false });

    expect(await db.message.count()).toBe(1);
  });

  it("does not poison a transaction with a duplicate", async () => {
    await insertInboundMessage(db, inbound("wamid.1"));

    await inTransaction(
      db,
      async (tx) => {
        await insertInboundMessage(tx, inbound("wamid.1"));
        await insertInboundMessage(tx, inbound("wamid.2"));
      },
      10_000,
    );

    expect(await db.message.count()).toBe(2);
  });

  it("returns the unprocessed burst in arrival order", async () => {
    await insertInboundMessage(db, inbound("wamid.1", "uno"));
    await insertInboundMessage(db, inbound("wamid.2", "due"));
    await insertInboundMessage(db, inbound("wamid.3", null, "audio"));

    const burst = await receivedBurst(db, contactId, senderId);

    expect(burst.map((m) => [m.body, m.type])).toEqual([
      ["uno", "text"],
      ["due", "text"],
      [null, "audio"],
    ]);
  });

  it("marks messages processed with their redacted copy, and serves it as history", async () => {
    await insertInboundMessage(db, inbound("wamid.1", "mi chiamo Mario"));
    await insertInboundMessage(db, inbound("wamid.2", "abito a Bologna"));
    const burst = await receivedBurst(db, contactId, senderId);
    const session = await seedSession();

    await markInboundProcessed(
      db,
      burst.map((m) => ({
        id: m.id,
        sessionId: session,
        turnId: null,
        bodyRedacted: m.body === "mi chiamo Mario" ? "mi chiamo [firstName]" : m.body,
      })),
    );

    expect(await receivedBurst(db, contactId, senderId)).toEqual([]);
    expect(await recentRedactedHistory(db, session, 5)).toEqual([
      "mi chiamo [firstName]",
      "abito a Bologna",
    ]);
    expect(await recentRedactedHistory(db, session, 1)).toEqual(["abito a Bologna"]);
    expect(await recentRedactedHistory(db, session, 0)).toEqual([]);
  });
});

async function seedSession(): Promise<string> {
  const { loadStandardCampaign } = await import("./helpers/registry");
  const { importCampaign } = await import("../../src/campaigns/import");
  const imported = await importCampaign(db, loadStandardCampaign(), {
    activate: true,
    nodeEnv: "development",
  });
  if (!imported.ok) throw new Error("import failed");
  const session = await db.session.create({
    data: {
      contactId,
      senderNumberId: senderId,
      campaignVersionId: imported.versionId,
      engineState: {},
      openKey: `${contactId}:${senderId}`,
      profile: { create: {} },
    },
  });
  return session.id;
}

describe("outbound messages (D108)", () => {
  const out = (sessionId: string, turnId: string | null, body: string) => ({
    contactId,
    senderNumberId: senderId,
    sessionId,
    turnId,
    body,
    language: "it",
    stepId: null,
    questionId: null,
  });
  const NOW = new Date("2026-10-24T10:00:00Z");
  const LEASE = 60_000;

  it("keeps the order of insertion", async () => {
    const session = await seedSession();
    await queueOutbound(db, [
      out(session, null, "uno"),
      out(session, null, "due"),
      out(session, null, "tre"),
    ]);

    const bodies: string[] = [];
    for (;;) {
      const claim = await claimNextOutbound(
        db,
        { contactId, senderNumberId: senderId },
        NOW,
        LEASE,
      );
      if (claim === null) break;
      if (claim === "busy") throw new Error("unexpected busy");
      bodies.push(claim.body);
      await finishSend(db, claim, {
        kind: "sent",
        providerMessageId: `out.${claim.body}`,
        at: NOW,
      });
    }

    expect(bodies).toEqual(["uno", "due", "tre"]);
    expect(await db.message.count({ where: { status: "sent" } })).toBe(3);
  });

  it("does not hand out a second message while one is being sent, until the lease expires", async () => {
    const session = await seedSession();
    await queueOutbound(db, [out(session, null, "uno"), out(session, null, "due")]);
    const key = { contactId, senderNumberId: senderId };
    const first = await claimNextOutbound(db, key, NOW, LEASE);

    expect(first).toMatchObject({ body: "uno", attempts: 1 });
    expect(await claimNextOutbound(db, key, new Date(NOW.getTime() + 1000), LEASE)).toBe("busy");

    const later = new Date(NOW.getTime() + LEASE + 1);
    expect(await claimNextOutbound(db, key, later, LEASE)).toMatchObject({
      body: "uno",
      attempts: 2,
    });
  });

  it("ignores a late result from a claim that expired and was taken over", async () => {
    const session = await seedSession();
    await queueOutbound(db, [out(session, null, "uno"), out(session, null, "due")]);
    const key = { contactId, senderNumberId: senderId };
    const stale = await claimNextOutbound(db, key, NOW, LEASE);
    const fresh = await claimNextOutbound(db, key, new Date(NOW.getTime() + LEASE + 1), LEASE);
    if (stale === null || stale === "busy" || fresh === null || fresh === "busy") {
      throw new Error("expected two claims");
    }

    // The old sender comes back while the new one is still sending: it must not requeue.
    expect(await finishSend(db, stale, { kind: "transient", code: "timeout" })).toBe("lost_claim");
    expect(await db.message.findUniqueOrThrow({ where: { id: fresh.id } })).toMatchObject({
      status: "sending",
      errorCode: null,
    });

    expect(
      await finishSend(db, fresh, { kind: "sent", providerMessageId: "out.uno", at: NOW }),
    ).toBe("applied");
    // Too late again: neither the sent message nor the rest of the turn is touched.
    expect(await finishSend(db, stale, { kind: "permanent", code: "not_reachable", at: NOW })).toBe(
      "lost_claim",
    );

    const rows = await db.message.findMany({ orderBy: { ordinal: "asc" } });
    expect(rows.map((m) => [m.body, m.status, m.providerMessageId])).toEqual([
      ["uno", "sent", "out.uno"],
      ["due", "queued", null],
    ]);
  });

  it("puts a message back after a transient failure", async () => {
    const session = await seedSession();
    await queueOutbound(db, [out(session, null, "uno")]);
    const key = { contactId, senderNumberId: senderId };
    const claim = await claimNextOutbound(db, key, NOW, LEASE);
    if (claim === null || claim === "busy") throw new Error("expected a claim");

    await finishSend(db, claim, { kind: "transient", code: "rate_limited" });

    expect(await db.message.findFirstOrThrow()).toMatchObject({
      status: "queued",
      errorCode: "rate_limited",
      leaseUntil: null,
    });
  });

  it("fails the rest of the turn after a permanent failure", async () => {
    const session = await seedSession();
    const turn = await db.turn.create({
      data: {
        sessionId: session,
        inboundMessageIds: [],
        startedAt: NOW,
        completedAt: NOW,
        outcome: "replied",
      },
    });
    await queueOutbound(db, [
      out(session, turn.id, "uno"),
      out(session, turn.id, "due"),
      out(session, null, "altro turno"),
    ]);
    const claim = await claimNextOutbound(db, { contactId, senderNumberId: senderId }, NOW, LEASE);
    if (claim === null || claim === "busy") throw new Error("expected a claim");

    await finishSend(db, claim, { kind: "permanent", code: "not_reachable", at: NOW });

    const rows = await db.message.findMany({ orderBy: { ordinal: "asc" } });
    expect(rows.map((m) => [m.body, m.status, m.errorCode])).toEqual([
      ["uno", "failed", "not_reachable"],
      ["due", "failed", "skipped_after_failure"],
      ["altro turno", "queued", null],
    ]);
  });
});
