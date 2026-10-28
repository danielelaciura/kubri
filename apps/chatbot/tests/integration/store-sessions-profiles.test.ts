import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importCampaign } from "../../src/campaigns/import";
import { initialSessionState } from "../../src/engine/state";
import { encodeState } from "../../src/runtime/state-codec";
import { upsertContact } from "../../src/store/contacts";
import { insertInboundMessage, queueOutbound } from "../../src/store/messages";
import {
  applyProfileFields,
  loadProfile,
  markFieldUnresolved,
  purgeSessionData,
  setSharedWithGlobal,
} from "../../src/store/profiles";
import {
  closeOpenKey,
  createSession,
  findOpenSession,
  findSessionById,
  markNeedsAttention,
  saveSession,
} from "../../src/store/sessions";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { loadStandardCampaign, seedRegistry } from "./helpers/registry";

const db = createTestDatabase();
let contactId = "";
let senderId = "";
let versionId = "";

beforeEach(async () => {
  await resetBotSchema(db);
  senderId = (await seedRegistry(db)).sender.id;
  const imported = await importCampaign(db, loadStandardCampaign(), {
    activate: true,
    nodeEnv: "development",
  });
  if (!imported.ok) throw new Error("import failed");
  versionId = imported.versionId;
  contactId = (
    await upsertContact(db, {
      channel: "whatsapp",
      externalId: "3933311",
      phoneE164: "+393331112233",
    })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

const NOW = new Date("2026-10-24T10:00:00Z");
const start = () =>
  createSession(db, {
    contactId,
    senderNumberId: senderId,
    campaignVersionId: versionId,
    state: encodeState(initialSessionState()),
    at: NOW,
  });

describe("sessions", () => {
  it("creates an open session with an empty profile, found by contact and number", async () => {
    const session = await start();

    expect(await findOpenSession(db, contactId, senderId)).toMatchObject({
      id: session.id,
      status: "active",
    });
    expect(await loadProfile(db, session.id)).toEqual({ standard: {}, custom: {}, fieldMeta: {} });
  });

  it("refuses a second open session for the same contact and number", async () => {
    await start();

    await expect(start()).rejects.toThrow();
  });

  it("saves state, status and timestamps, and closes the open key", async () => {
    const session = await start();

    await saveSession(db, session.id, {
      state: { ...encodeState(initialSessionState()), phase: "closed" },
      language: "ar",
      status: "stopped",
      at: NOW,
      stoppedAt: NOW,
      closeOpen: true,
    });

    expect(await findOpenSession(db, contactId, senderId)).toBeNull();
    expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
      status: "stopped",
      language: "ar",
      stoppedAt: NOW,
      openKey: null,
    });
    // A new session can start now.
    await expect(start()).resolves.toBeDefined();
  });

  it("closes the open key on its own", async () => {
    const session = await start();

    await closeOpenKey(db, session.id);

    expect(await findOpenSession(db, contactId, senderId)).toBeNull();
    // An interview left for another campaign is abandoned (the CHECK forbids an active one
    // without a key).
    expect((await findSessionById(db, session.id))?.status).toBe("abandoned");
  });

  it("closes a completed session's key and keeps it completed", async () => {
    const session = await start();
    await saveSession(db, session.id, {
      language: null,
      status: "completed",
      at: NOW,
      completedAt: NOW,
      closeOpen: false,
    });

    await closeOpenKey(db, session.id);

    expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
      status: "completed",
      openKey: null,
    });
  });

  it("drops the key whenever the status is a closed one", async () => {
    const session = await start();

    await saveSession(db, session.id, {
      language: null,
      status: "stopped",
      at: NOW,
      closeOpen: false,
    });

    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).openKey).toBeNull();
  });

  it("refuses to close the key of a session that stays active", async () => {
    const session = await start();

    await expect(
      saveSession(db, session.id, { language: null, status: "active", at: NOW, closeOpen: true }),
    ).rejects.toThrow(/open status/);
  });

  it("does not overwrite the stored state when none is given", async () => {
    const session = await start();
    await db.session.update({
      where: { id: session.id },
      data: { engineState: { corrupt: true } },
    });

    await saveSession(db, session.id, {
      language: null,
      status: "active",
      at: NOW,
      closeOpen: false,
    });

    expect((await findSessionById(db, session.id))?.engineState).toEqual({ corrupt: true });
  });

  it("moves only an active session to needs_attention", async () => {
    const session = await start();
    await markNeedsAttention(db, session.id);
    expect((await findSessionById(db, session.id))?.status).toBe("needs_attention");

    await db.session.update({ where: { id: session.id }, data: { status: "completed" } });
    await markNeedsAttention(db, session.id);

    expect((await findSessionById(db, session.id))?.status).toBe("completed");
  });
});

describe("profiles", () => {
  it("applies fields and records one ProfileChange per field", async () => {
    const session = await start();

    await applyProfileFields(db, session.id, "extraction", null, [
      { field: "firstName", value: "Mario", confidence: 0.95, status: "inferred" },
      { field: "custom.night_shifts", value: true, confidence: 0.9, status: "inferred" },
    ]);
    await applyProfileFields(db, session.id, "edit", null, [
      { field: "firstName", value: "Maria", confidence: 1, status: "confirmed" },
    ]);

    const profile = await loadProfile(db, session.id);
    expect(profile.standard).toEqual({ firstName: "Maria" });
    expect(profile.custom).toEqual({ night_shifts: true });
    expect(profile.fieldMeta["firstName"]).toEqual({
      confidence: 1,
      status: "confirmed",
      source: "edit",
    });
    const changes = await db.profileChange.findMany({ orderBy: { createdAt: "asc" } });
    expect(changes.map((c) => [c.field, c.oldValue, c.newValue, c.source])).toEqual([
      ["firstName", null, "Mario", "extraction"],
      ["custom.night_shifts", null, true, "extraction"],
      ["firstName", "Mario", "Maria", "edit"],
    ]);
  });

  it("marks a field unresolved with a system change", async () => {
    const session = await start();
    await applyProfileFields(db, session.id, "extraction", null, [
      { field: "email", value: "a@b.it", confidence: 0.9, status: "inferred" },
    ]);

    await markFieldUnresolved(db, session.id, "email", null);

    expect((await loadProfile(db, session.id)).fieldMeta["email"]?.status).toBe("unresolved");
    expect(
      (await db.profileChange.findMany({ where: { source: "system" } })).map((c) => c.field),
    ).toEqual(["email"]);
  });

  it("stores the outcome of kubri_global", async () => {
    const session = await start();

    await setSharedWithGlobal(db, session.id, true);

    expect(
      (await db.candidateProfile.findUniqueOrThrow({ where: { sessionId: session.id } }))
        .sharedWithGlobal,
    ).toBe(true);
  });

  it("purges the personal data of a session but keeps unsent replies (D109)", async () => {
    const session = await start();
    await applyProfileFields(db, session.id, "extraction", null, [
      { field: "firstName", value: "Mario", confidence: 0.9, status: "inferred" },
    ]);
    await insertInboundMessage(db, {
      contactId,
      senderNumberId: senderId,
      providerMessageId: "wamid.1",
      type: "text",
      body: "mi chiamo Mario",
      payloadRaw: { a: 1 },
    });
    await db.message.updateMany({
      data: { sessionId: session.id, bodyRedacted: "mi chiamo [firstName]", status: "processed" },
    });
    await queueOutbound(db, [
      {
        contactId,
        senderNumberId: senderId,
        sessionId: session.id,
        turnId: null,
        body: "Per «nome» ho capito: Mario",
        language: "it",
        stepId: null,
        questionId: null,
      },
    ]);
    await db.message.create({
      data: {
        contactId,
        senderNumberId: senderId,
        sessionId: session.id,
        direction: "outbound",
        type: "text",
        body: "Ciao Mario",
        status: "sent",
      },
    });
    await db.nluTrace.create({
      data: {
        turn: {
          create: {
            sessionId: session.id,
            inboundMessageIds: [],
            startedAt: NOW,
            completedAt: NOW,
            outcome: "replied",
          },
        },
        task: "interpret",
        promptVersion: "p",
        provider: "fake",
        model: "m",
        attempt: "primary",
        repair: false,
        input: [{ role: "user", content: "Mario" }],
        output: "{}",
        valid: true,
        latencyMs: 1,
        createdAt: NOW,
      },
    });

    await purgeSessionData(db, session.id);

    expect(await loadProfile(db, session.id)).toEqual({ standard: {}, custom: {}, fieldMeta: {} });
    expect(await db.profileChange.count()).toBe(0);
    expect(await db.nluTrace.count()).toBe(0);
    const messages = await db.message.findMany({ orderBy: { ordinal: "asc" } });
    expect(
      messages.map((m) => [m.direction, m.status, m.body, m.bodyRedacted, m.payloadRaw]),
    ).toEqual([
      ["inbound", "processed", null, null, null],
      ["outbound", "queued", "Per «nome» ho capito: Mario", null, null],
      ["outbound", "sent", null, null, null],
    ]);
  });
});
