import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleStatusUpdate, type StatusUpdate } from "../../src/runtime/delivery";
import { MemoryJobQueue } from "../../src/runtime/memory-queue";
import { reportOutboundFailure } from "../../src/runtime/outbound-failure";
import { claimNextOutbound, finishSend, queueOutbound } from "../../src/store/messages";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import {
  seedScenario,
  silentLogger,
  startSession,
  testConfig,
  type Scenario,
} from "./helpers/runtime";

const db = createTestDatabase();
const AT = new Date("2026-10-24T10:05:00Z");
let s: Scenario;
let sessionId = "";
let turnId = "";
let queue: MemoryJobQueue;

const deps = () => ({ db, queue, logger: silentLogger, now: () => AT });

beforeEach(async () => {
  await resetBotSchema(db);
  queue = new MemoryJobQueue();
  s = await seedScenario(db);
  sessionId = (await startSession(s)).id;
  const key = { contactId: s.contactId, senderNumberId: s.senderId };
  turnId = (
    await db.turn.create({
      data: {
        sessionId,
        contactId: s.contactId,
        inboundMessageIds: [],
        startedAt: AT,
        completedAt: AT,
        outcome: "replied",
      },
    })
  ).id;
  await queueOutbound(db, [
    {
      ...key,
      sessionId,
      turnId,
      body: "ciao",
      language: "it",
      stepId: null,
      questionId: null,
    },
  ]);
  const claim = await claimNextOutbound(db, key, new Date(), 60_000);
  if (claim === null || claim === "busy") throw new Error("expected a claim");
  await finishSend(db, claim, { kind: "sent", providerMessageId: "wamid.OUT1", at: new Date() });
});

afterAll(async () => {
  await db.$disconnect();
});

const update = (
  status: StatusUpdate["status"],
  errorCode: string | null = null,
  providerMessageId = "wamid.OUT1",
): StatusUpdate => ({ providerMessageId, status, at: AT, errorCode });

describe("handleStatusUpdate", () => {
  it("moves a message forward", async () => {
    await handleStatusUpdate(deps(), update("delivered"));
    await handleStatusUpdate(deps(), update("read"));

    expect(await db.message.findFirstOrThrow()).toMatchObject({
      status: "read",
      deliveredAt: AT,
      readAt: AT,
    });
    expect(queue.jobs).toEqual([]);
  });

  it("marks a failed delivery and queues the failure report, in one transaction (D120, C7)", async () => {
    await handleStatusUpdate(deps(), update("failed", "outside_window"));

    expect(await db.message.findFirstOrThrow()).toMatchObject({
      status: "failed",
      errorCode: "outside_window",
    });
    expect(queue.jobs).toEqual([
      {
        name: "report-failure",
        payload: { contactId: s.contactId, sessionId, turnId },
        options: {},
        inTransaction: true,
      },
    ]);
    // The webhook never waits for the contact's lock: the session is flagged by the job.
    expect(await db.sessionFlag.count()).toBe(0);
  });

  it("flags the session when the report-failure job runs", async () => {
    await handleStatusUpdate(deps(), update("failed", "not_reachable"));
    const job = queue.named("report-failure")[0];
    if (!job) throw new Error("expected a job");

    await reportOutboundFailure(
      { db, config: testConfig(), logger: silentLogger, now: () => AT },
      job.payload as { contactId: string; sessionId: string; turnId: string | null },
    );

    expect((await db.session.findFirstOrThrow()).status).toBe("needs_attention");
    expect(await db.sessionFlag.findFirstOrThrow()).toMatchObject({
      reason: "outbound_failed",
      needsAttention: true,
      turnId,
    });
  });

  it("keeps a failure for a message it does not know yet as a dead letter (C7)", async () => {
    await handleStatusUpdate(deps(), update("failed", "not_reachable", "wamid.UNKNOWN"));

    expect(await db.inboundDeadLetter.findFirstOrThrow()).toMatchObject({
      reason: "status_unknown_message",
    });
    expect(queue.jobs).toEqual([]);
  });

  it("ignores other statuses of unknown messages, and a late failure after read", async () => {
    await handleStatusUpdate(deps(), update("delivered", null, "wamid.UNKNOWN"));
    await handleStatusUpdate(deps(), update("read"));
    await handleStatusUpdate(deps(), update("failed", "not_reachable"));

    expect((await db.message.findFirstOrThrow()).status).toBe("read");
    expect(await db.inboundDeadLetter.count()).toBe(0);
    expect(queue.jobs).toEqual([]);
  });
});
