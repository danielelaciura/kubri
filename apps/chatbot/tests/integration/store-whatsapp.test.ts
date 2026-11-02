import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { findLastInboundAt, registerInbound } from "../../src/store/contacts";
import { insertDeadLetter } from "../../src/store/dead-letters";
import { pingDatabase } from "../../src/store/health";
import {
  applyDeliveryStatus,
  claimNextOutbound,
  finishSend,
  insertInboundMessage,
  latestReceivedProviderId,
  queueOutbound,
  receivedBurst,
} from "../../src/store/messages";
import { findSenderByPhoneNumberId } from "../../src/store/senders";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedScenario, startSession, type Scenario } from "./helpers/runtime";

const db = createTestDatabase();
let s: Scenario;
let sessionId = "";
const NOW = new Date("2026-10-24T10:00:00Z");

beforeEach(async () => {
  await resetBotSchema(db);
  s = await seedScenario(db);
  sessionId = (await startSession(s)).id;
});

afterAll(async () => {
  await db.$disconnect();
});

const key = () => ({ contactId: s.contactId, senderNumberId: s.senderId });

describe("dead letters and health", () => {
  it("keeps an unprocessable payload with its reason", async () => {
    await insertDeadLetter(db, { raw: { entry: [] }, reason: "unknown_sender" });

    expect(await db.inboundDeadLetter.findFirstOrThrow()).toMatchObject({
      reason: "unknown_sender",
      raw: { entry: [] },
    });
  });

  it("answers a ping", async () => {
    await expect(pingDatabase(db)).resolves.toBeUndefined();
  });
});

describe("sender lookup", () => {
  it("finds a Meta number by its phone number id, and only that", async () => {
    expect(await findSenderByPhoneNumberId(db, "123456789012345")).toMatchObject({
      id: s.senderId,
      slug: "kubri-main",
    });
    expect(await findSenderByPhoneNumberId(db, "999")).toBeNull();
  });

  it("ignores a suspended number (C8)", async () => {
    await db.senderNumber.update({ where: { id: s.senderId }, data: { status: "suspended" } });

    expect(await findSenderByPhoneNumberId(db, "123456789012345")).toBeNull();
  });
});

describe("interactive messages", () => {
  const choices = {
    listButton: "Scegli",
    options: [
      { id: "q:patente:yes", title: "Sì" },
      { id: "q:patente:no", title: "No" },
    ],
  };

  it("stores and claims an interactive reply with its choices (D116)", async () => {
    await queueOutbound(db, [
      {
        ...key(),
        sessionId,
        turnId: null,
        body: "Hai la patente?",
        language: "it",
        stepId: null,
        questionId: null,
        interactive: choices,
      },
      {
        ...key(),
        sessionId,
        turnId: null,
        body: "Testo",
        language: "it",
        stepId: null,
        questionId: null,
      },
    ]);

    const rows = await db.message.findMany({ orderBy: { ordinal: "asc" } });
    expect(rows.map((r) => r.type)).toEqual(["interactive", "text"]);

    const first = await claimNextOutbound(db, key(), NOW, 60_000);
    expect(first).toMatchObject({ body: "Hai la patente?", interactive: choices });
    if (first === null || first === "busy") throw new Error("expected a claim");
    await finishSend(db, first, { kind: "sent", providerMessageId: "w1", at: NOW });
    expect(await claimNextOutbound(db, key(), NOW, 60_000)).toMatchObject({
      body: "Testo",
      interactive: null,
    });
  });

  it("stores a tap with its id and the title as the body", async () => {
    await insertInboundMessage(db, {
      ...key(),
      providerMessageId: "wamid.tap",
      type: "interactive",
      body: "Accetto",
      replyId: "consent:privacy:accepted",
      payloadRaw: {},
    });

    expect(await receivedBurst(db, s.contactId, s.senderId)).toMatchObject([
      { type: "interactive", body: "Accetto", replyId: "consent:privacy:accepted" },
    ]);
  });

  it("finds the newest received message, for the read receipt", async () => {
    await insertInboundMessage(db, {
      ...key(),
      providerMessageId: "w.1",
      type: "text",
      body: "uno",
      payloadRaw: {},
    });
    await insertInboundMessage(db, {
      ...key(),
      providerMessageId: "w.2",
      type: "text",
      body: "due",
      payloadRaw: {},
    });

    expect(await latestReceivedProviderId(db, s.contactId, s.senderId)).toBe("w.2");
  });
});

describe("delivery statuses (D120)", () => {
  async function sentMessage(providerMessageId = "wamid.out.1") {
    await queueOutbound(db, [
      {
        ...key(),
        sessionId,
        turnId: null,
        body: "ciao",
        language: "it",
        stepId: null,
        questionId: null,
      },
    ]);
    const claim = await claimNextOutbound(db, key(), NOW, 60_000);
    if (claim === null || claim === "busy") throw new Error("expected a claim");
    await finishSend(db, claim, { kind: "sent", providerMessageId, at: NOW });
  }
  const status = (st: "sent" | "delivered" | "read" | "failed", errorCode: string | null = null) =>
    applyDeliveryStatus(db, {
      providerMessageId: "wamid.out.1",
      status: st,
      at: new Date("2026-10-24T10:05:00Z"),
      errorCode,
    });

  it("moves forward only: sent → delivered → read", async () => {
    await sentMessage();

    expect(await status("delivered")).toMatchObject({
      updated: true,
      sessionId,
      contactId: s.contactId,
    });
    expect((await db.message.findFirstOrThrow()).status).toBe("delivered");
    expect(await status("read")).toMatchObject({ updated: true });
    expect(await status("delivered")).toMatchObject({ updated: false });
    const row = await db.message.findFirstOrThrow();
    expect(row.status).toBe("read");
    expect(row.deliveredAt).toBeInstanceOf(Date);
    expect(row.readAt).toBeInstanceOf(Date);
  });

  it("does nothing for a repeated sent, or for an unknown message", async () => {
    await sentMessage();

    expect((await status("sent")).updated).toBe(false);
    expect(
      await applyDeliveryStatus(db, {
        providerMessageId: "nope",
        status: "read",
        at: NOW,
        errorCode: null,
      }),
    ).toEqual({ updated: false, contactId: null, sessionId: null, turnId: null });
  });

  it("records a delivery failure with its code", async () => {
    await sentMessage();

    expect(await status("failed", "outside_window")).toMatchObject({
      updated: true,
      sessionId,
    });
    expect(await db.message.findFirstOrThrow()).toMatchObject({
      status: "failed",
      errorCode: "outside_window",
    });
  });
});

describe("24 hour window", () => {
  it("only moves forward when messages arrive out of order", async () => {
    const later = new Date("2026-10-24T10:00:00Z");
    const earlier = new Date("2026-10-24T09:59:00Z");

    await registerInbound(db, { ...key(), at: later });
    await registerInbound(db, { ...key(), at: earlier });

    expect(await findLastInboundAt(db, s.contactId, s.senderId)).toEqual(later);
  });
});
