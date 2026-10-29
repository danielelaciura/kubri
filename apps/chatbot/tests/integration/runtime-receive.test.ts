import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryJobQueue } from "../../src/runtime/memory-queue";
import { receiveInbound, type InboundMessage } from "../../src/runtime/receive";
import { recordOptOut } from "../../src/store/contacts";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedScenario, testConfig, type Scenario } from "./helpers/runtime";

const db = createTestDatabase();
let scenario: Scenario;

beforeEach(async () => {
  await resetBotSchema(db);
  scenario = await seedScenario(db, { importStandard: false });
});

afterAll(async () => {
  await db.$disconnect();
});

const message = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  senderNumberId: scenario.senderId,
  providerMessageId: "wamid.1",
  from: { externalId: "393334445566", phoneE164: "+393334445566" },
  type: "text",
  body: "ciao",
  receivedAt: new Date("2026-10-24T10:00:00Z"),
  payloadRaw: { wamid: "wamid.1" },
  ...overrides,
});

describe("receiveInbound", () => {
  it("stores the message, opens the window and enqueues the turn after the quiet time", async () => {
    const queue = new MemoryJobQueue();

    const result = await receiveInbound(
      { db, queue, config: testConfig({ DEBOUNCE_MS: "3000" }) },
      message(),
    );

    expect(result).toEqual({ duplicate: false });
    const contact = await db.contact.findUniqueOrThrow({
      where: { channel_externalId: { channel: "whatsapp", externalId: "393334445566" } },
    });
    expect(await db.message.findFirstOrThrow()).toMatchObject({
      contactId: contact.id,
      senderNumberId: scenario.senderId,
      sessionId: null,
      status: "received",
      direction: "inbound",
      body: "ciao",
      bodyRedacted: null,
    });
    expect((await db.contactChannelState.findFirstOrThrow()).lastInboundAt).toEqual(
      new Date("2026-10-24T10:00:00Z"),
    );
    expect(queue.jobs).toEqual([
      {
        name: "process-contact",
        payload: { contactId: contact.id, senderNumberId: scenario.senderId },
        options: { startAfterSeconds: 3 },
        inTransaction: true,
      },
    ]);
  });

  it("enqueues with no delay when there is no quiet time", async () => {
    const queue = new MemoryJobQueue();

    await receiveInbound({ db, queue, config: testConfig({ DEBOUNCE_MS: "0" }) }, message());

    expect(queue.jobs[0]?.options).toEqual({});
  });

  it("rounds a quiet time below a second up to one second", async () => {
    const queue = new MemoryJobQueue();

    await receiveInbound({ db, queue, config: testConfig({ DEBOUNCE_MS: "1500" }) }, message());

    expect(queue.jobs[0]?.options).toEqual({ startAfterSeconds: 2 });
  });

  it("ignores a duplicate: no second message, no second job", async () => {
    const queue = new MemoryJobQueue();
    const deps = { db, queue, config: testConfig() };

    await receiveInbound(deps, message());
    const again = await receiveInbound(deps, message());

    expect(again).toEqual({ duplicate: true });
    expect(await db.message.count()).toBe(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it("keeps the arrival order of messages from the same person", async () => {
    const queue = new MemoryJobQueue();
    const deps = { db, queue, config: testConfig() };

    await receiveInbound(deps, message({ providerMessageId: "wamid.1", body: "uno" }));
    await receiveInbound(deps, message({ providerMessageId: "wamid.2", body: "due" }));

    expect((await db.message.findMany({ orderBy: { ordinal: "asc" } })).map((m) => m.body)).toEqual(
      ["uno", "due"],
    );
    // The scenario's own contact plus this one: the second message found the same row.
    expect(await db.contact.count({ where: { externalId: "393334445566" } })).toBe(1);
  });

  it("brings an opted-out contact back to opted_in (D105)", async () => {
    const queue = new MemoryJobQueue();
    await recordOptOut(db, scenario.contactId, scenario.senderId, new Date("2026-10-23T10:00:00Z"));

    await receiveInbound(
      { db, queue, config: testConfig() },
      message({ from: { externalId: scenario.externalId, phoneE164: scenario.phone } }),
    );

    expect(await db.contactChannelState.findFirstOrThrow()).toMatchObject({
      optInStatus: "opted_in",
      optInSource: "inbound",
    });
  });
});
