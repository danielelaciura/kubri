import { pino } from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  FakeChannel,
  type ChannelAdapter,
  type OutboundText,
  type SendOutcome,
} from "../../src/channels/channel";
import { TransientJobError } from "../../src/runtime/jobs/errors";
import { CV_FAILED, CV_FILENAME, handleCv, type CvJobDeps } from "../../src/runtime/jobs/cv";
import { MemoryJobQueue } from "../../src/runtime/memory-queue";
import { applyProfileFields } from "../../src/store/profiles";
import { insertTurn } from "../../src/store/turns";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import {
  seedScenario,
  silentLogger,
  startSession,
  testConfig,
  testResolver,
  type Scenario,
} from "./helpers/runtime";

const db = createTestDatabase();
const TURN_ID = "0b5e8c1a-7d3f-4e29-9a61-2c4d8f0e6b17";
const NOT_LAST = { retryCount: 0, lastAttempt: false } as const;
const LAST = { retryCount: 5, lastAttempt: true } as const;

let s: Scenario;
let sessionId = "";
let channel: ChannelAdapter;
let fake: FakeChannel;
let queue: MemoryJobQueue;
let logger = silentLogger;

const deps = (): CvJobDeps => ({
  db,
  config: testConfig(),
  logger,
  queue,
  resolver: testResolver(),
  channelFor: () => channel,
  now: () => new Date(),
});
const job = () => ({ sessionId, turnId: TURN_ID });
const outbound = () =>
  db.message.findMany({ where: { sessionId, direction: "outbound" }, orderBy: { ordinal: "asc" } });
const flags = () => db.sessionFlag.findMany({ where: { sessionId } });

/** Closing a session: the status and the open key together (Session_openKey_status_check). */
const stop = () =>
  db.session.update({ where: { id: sessionId }, data: { status: "stopped", openKey: null } });

beforeEach(async () => {
  await resetBotSchema(db);
  s = await seedScenario(db);
  sessionId = (await startSession(s)).id;
  await insertTurn(db, {
    id: TURN_ID,
    sessionId,
    contactId: s.contactId,
    inboundMessageIds: [],
    startedAt: new Date(),
    completedAt: new Date(),
    outcome: "replied",
  });
  await applyProfileFields(db, sessionId, "extraction", null, [
    { field: "firstName", value: "Karim", confidence: 0.95, status: "inferred" },
    { field: "lastName", value: "Benali", confidence: 0.95, status: "inferred" },
  ]);
  fake = new FakeChannel();
  channel = fake;
  queue = new MemoryJobQueue();
  logger = silentLogger;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("handleCv (spec §12.2, R8, D127–D131)", () => {
  it("uploads the PDF and queues it as a document of the requesting turn, with its send", async () => {
    expect(await handleCv(deps(), job(), NOT_LAST)).toBe("sent");

    expect(fake.uploaded).toHaveLength(1);
    expect(fake.uploaded[0]).toMatchObject({ filename: CV_FILENAME, mimeType: "application/pdf" });
    const bytes = Buffer.from(fake.uploaded[0]?.bytes ?? new Uint8Array());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const [message, ...rest] = await outbound();
    expect(rest).toEqual([]);
    expect(message).toMatchObject({
      type: "document",
      status: "queued",
      turnId: TURN_ID,
      mediaRef: "fake-media-1",
      mediaFilename: "CV.pdf",
      language: "it",
    });
    expect(message?.body).toContain("CV");
    expect(queue.jobs).toEqual([
      expect.objectContaining({
        name: "send-messages",
        payload: { contactId: s.contactId, senderNumberId: s.senderId },
        inTransaction: true,
      }),
    ]);
    expect(await flags()).toEqual([]);
  });

  it("writes the caption in the session's language", async () => {
    await db.session.update({ where: { id: sessionId }, data: { language: "en" } });

    await handleCv(deps(), job(), NOT_LAST);

    expect((await outbound())[0]).toMatchObject({ language: "en" });
    expect((await outbound())[0]?.body).toMatch(/^\[en\] /);
  });

  it("does nothing the second time for the same turn: a retry after the commit sends no second CV", async () => {
    await handleCv(deps(), job(), NOT_LAST);

    expect(await handleCv(deps(), job(), NOT_LAST)).toBe("skipped");

    expect(fake.uploaded).toHaveLength(1);
    expect(await outbound()).toHaveLength(1);
  });

  it("skips a session that no longer exists", async () => {
    await db.contact.delete({ where: { id: s.contactId } });

    expect(await handleCv(deps(), job(), NOT_LAST)).toBe("skipped");
    expect(fake.uploaded).toEqual([]);
  });

  it("skips a session stopped after an opt-out or a deletion", async () => {
    await stop();

    expect(await handleCv(deps(), job(), NOT_LAST)).toBe("skipped");
    expect(fake.uploaded).toEqual([]);
    expect(await outbound()).toEqual([]);
  });

  it("asks pg-boss for a retry when the upload fails for now", async () => {
    fake.enqueueUploadOutcome({ ok: false, kind: "transient", code: "rate_limited" });

    await expect(handleCv(deps(), job(), NOT_LAST)).rejects.toThrow(TransientJobError);

    expect(await outbound()).toEqual([]);
    expect(queue.jobs).toEqual([]);
    expect(await flags()).toEqual([]);
  });

  it("on the last attempt tells the candidate once and flags the session, without needs_attention (D131)", async () => {
    fake.enqueueUploadOutcome({ ok: false, kind: "transient", code: "rate_limited" });

    expect(await handleCv(deps(), job(), LAST)).toBe("failed");

    const [message, ...rest] = await outbound();
    expect(rest).toEqual([]);
    expect(message).toMatchObject({ type: "text", turnId: TURN_ID, mediaRef: null });
    expect(message?.body).toContain("non sono riuscito");
    expect(await flags()).toMatchObject([
      { reason: CV_FAILED, needsAttention: false, turnId: TURN_ID },
    ]);
    expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe(
      "active",
    );
    expect(queue.named("send-messages")).toHaveLength(1);
  });

  it("gives up at once on a definitive upload error, and only once", async () => {
    fake.enqueueUploadOutcome({ ok: false, kind: "permanent", code: "invalid_media" });
    fake.enqueueUploadOutcome({ ok: false, kind: "permanent", code: "invalid_media" });

    expect(await handleCv(deps(), job(), NOT_LAST)).toBe("failed");
    expect(await handleCv(deps(), job(), NOT_LAST)).toBe("skipped");

    expect(await outbound()).toHaveLength(1);
    expect(await flags()).toHaveLength(1);
  });

  it("treats a channel that cannot upload documents as a definitive failure", async () => {
    channel = {
      supportsInteractive: false,
      freeFormWindowMs: null,
      send: (_message: OutboundText): Promise<SendOutcome> =>
        Promise.resolve({ ok: true, providerMessageId: "x" }),
    };

    expect(await handleCv(deps(), job(), NOT_LAST)).toBe("failed");
    expect(await flags()).toMatchObject([{ reason: CV_FAILED }]);
  });

  it("never writes the CV's content in the logs", async () => {
    const lines: string[] = [];
    logger = pino({ level: "debug" }, { write: (line: string) => lines.push(line) });
    fake.enqueueUploadOutcome({ ok: false, kind: "permanent", code: "invalid_media" });

    await handleCv(deps(), job(), NOT_LAST);
    fake = new FakeChannel();
    channel = fake;
    await db.message.deleteMany({ where: { sessionId } });
    await db.sessionFlag.deleteMany({ where: { sessionId } });
    await handleCv(deps(), job(), NOT_LAST);

    expect(lines.length).toBeGreaterThan(0);
    const all = lines.join("\n");
    expect(all).not.toContain("Karim");
    expect(all).not.toContain("Benali");
    expect(all).not.toContain(s.phone);
  });
});
