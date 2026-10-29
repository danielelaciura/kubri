import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Effect } from "../../src/engine/effects";
import { initialSessionState, type SessionState } from "../../src/engine/state";
import type { TextRef } from "../../src/engine/text-ref";
import { systemText } from "../../src/engine/turn";
import {
  applyEffects,
  type ApplyContext,
  type InboundOfTurn,
} from "../../src/runtime/apply-effects";
import { MemoryJobQueue } from "../../src/runtime/memory-queue";
import { inTransaction } from "../../src/store/db";
import { insertInboundMessage } from "../../src/store/messages";
import { loadProfile } from "../../src/store/profiles";
import { insertTurn } from "../../src/store/turns";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import {
  TEST_CONSENT_SECRET,
  seedScenario,
  silentLogger,
  startSession,
  testResolver,
  type Scenario,
} from "./helpers/runtime";

const db = createTestDatabase();
let scenario: Scenario;
let sessionId = "";
let queue: MemoryJobQueue;

beforeEach(async () => {
  await resetBotSchema(db);
  scenario = await seedScenario(db);
  sessionId = (await startSession(scenario)).id;
  queue = new MemoryJobQueue();
});

afterAll(async () => {
  await db.$disconnect();
});

const AT = "2026-10-24T10:00:00.000Z";
const TURN_ID = "6f1c5f0e-3b8a-4a43-9d6e-5d0b6f7d2a11";
const IT_STATE: SessionState = { ...initialSessionState(), language: "it" };

interface RunOptions {
  readonly finalState?: SessionState;
  readonly inbound?: readonly InboundOfTurn[];
  readonly answeringMessageId?: string | null;
}

async function run(effects: Effect[], options: RunOptions = {}) {
  const campaign = scenario.campaign;
  if (!campaign) throw new Error("no campaign");
  return inTransaction(
    db,
    async (tx) => {
      await insertTurn(tx, {
        id: TURN_ID,
        sessionId,
        contactId: scenario.contactId,
        inboundMessageIds: (options.inbound ?? []).map((m) => m.id),
        startedAt: new Date(AT),
        completedAt: new Date(AT),
        outcome: "replied",
      });
      const ctx: ApplyContext = {
        tx,
        queue,
        resolver: testResolver(),
        logger: silentLogger,
        consentHashSecret: TEST_CONSENT_SECRET,
        turnId: TURN_ID,
        at: new Date(AT),
        contact: { id: scenario.contactId, channel: "whatsapp", externalId: scenario.externalId },
        session: { id: sessionId, senderNumberId: scenario.senderId },
        campaign: campaign.definition,
        finalState: options.finalState ?? IT_STATE,
        answeringMessageId: options.answeringMessageId ?? null,
        inbound: options.inbound ?? [],
      };
      return applyEffects(ctx, effects);
    },
    10_000,
  );
}

/** An inbound message of the current turn, still without a session (as receive.ts stores it). */
async function inbound(body: string, providerMessageId = "wamid.1"): Promise<string> {
  await insertInboundMessage(db, {
    contactId: scenario.contactId,
    senderNumberId: scenario.senderId,
    providerMessageId,
    type: "text",
    body,
    payloadRaw: { wamid: providerMessageId },
  });
  return (await db.message.findFirstOrThrow({ where: { providerMessageId } })).id;
}

const consent = (
  key: string,
  outcome: "accepted" | "declined",
  text: TextRef = { kind: "system", key: "system.stopped" },
  language: "it" | "en" = "it",
): Effect => ({
  type: "RecordConsent",
  stepId: key === "kubri_global" ? "pool_globale" : "privacy",
  consentKey: key,
  textVersion: "placeholder-2026-10",
  text,
  dataController: { name: "Kubri", privacyUrl: "https://kubri.it/privacy" },
  language,
  outcome,
  at: AT,
});

/** The standard campaign's privacy step text, as the engine refers to it (consentTextRef). */
function privacyTextRef(): TextRef {
  const step = scenario.campaign?.definition.flow.find((s) => s.id === "privacy");
  if (step?.type !== "consent" || "ref" in step.text) throw new Error("fixture");
  return { kind: "step", path: "privacy", text: step.text };
}

const firstName: Effect = {
  type: "ApplyPatch",
  source: "extraction",
  fields: [{ field: "firstName", value: "Mario", confidence: 0.95, status: "inferred" }],
};

describe("applyEffects", () => {
  it("queues SendText in order, in the language of the final state", async () => {
    const outcome = await run(
      [
        { type: "SendText", text: systemText("system.progress", { current: 1, total: 5 }) },
        { type: "SendText", text: { kind: "generated", text: "Ciao a te" } },
      ],
      { finalState: { ...IT_STATE, stepId: "anagrafica", questionId: "nome" } },
    );

    expect(outcome.outbound).toBe(2);
    const messages = await db.message.findMany({ orderBy: { ordinal: "asc" } });
    expect(
      messages.map((m) => [m.direction, m.status, m.body, m.language, m.stepId, m.questionId]),
    ).toEqual([
      ["outbound", "queued", "Sezione 1 di 5", "it", "anagrafica", "nome"],
      ["outbound", "queued", "Ciao a te", "it", "anagrafica", "nome"],
    ]);
    expect(messages.every((m) => m.turnId === TURN_ID && m.sessionId === sessionId)).toBe(true);
  });

  it("uses the purpose of a SendText (D76)", async () => {
    await run([
      {
        type: "SendText",
        text: { kind: "generated", text: "Come ti chiami?" },
        purpose: "rephrase",
      },
    ]);

    expect((await db.message.findFirstOrThrow()).body).toBe(
      "Provo a spiegarmi meglio:\nCome ti chiami?",
    );
  });

  it("resolves before the language is chosen in the campaign default (D77)", async () => {
    await run([{ type: "SendText", text: systemText("system.stopped") }], {
      finalState: initialSessionState(),
    });

    expect((await db.message.findFirstOrThrow()).language).toBe("it");
  });

  it("applies a patch and keeps one change per field", async () => {
    await run([firstName, { type: "MarkFieldUnresolved", field: "email" }]);

    const profile = await loadProfile(db, sessionId);
    expect(profile.standard).toEqual({ firstName: "Mario" });
    expect(profile.fieldMeta["email"]?.status).toBe("unresolved");
    const changes = await db.profileChange.findMany({ orderBy: { createdAt: "asc" } });
    expect(changes.map((c) => [c.field, c.source, c.turnId])).toEqual([
      ["firstName", "extraction", TURN_ID],
      ["email", "system", TURN_ID],
    ]);
  });

  it("records a consent with the resolved text and its curation, and the kubri_global outcome", async () => {
    const answer = await inbound("sì");
    await run([consent("privacy_interview", "accepted"), consent("kubri_global", "accepted")], {
      answeringMessageId: answer,
    });

    const consents = await db.consent.findMany({ orderBy: { createdAt: "asc" } });
    expect(
      consents.map((c) => [c.consentKey, c.outcome, c.language, c.textShownIsCurated, c.linkShown]),
    ).toEqual([
      ["privacy_interview", "accepted", "it", true, null],
      ["kubri_global", "accepted", "it", true, null],
    ]);
    expect(consents[0]).toMatchObject({
      textVersion: "placeholder-2026-10",
      dataController: { name: "Kubri", privacyUrl: "https://kubri.it/privacy" },
      messageId: answer,
      decidedAt: new Date(AT),
      sessionId,
      contactId: scenario.contactId,
    });
    expect(consents[0]?.textShown).toContain("l'intervista finisce qui");
    expect(consents[0]?.contactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (await db.candidateProfile.findUniqueOrThrow({ where: { sessionId } })).sharedWithGlobal,
    ).toBe(true);
  });

  it("records the official link shown under a consent text that is not curated (D111d)", async () => {
    await run([consent("privacy_interview", "accepted", privacyTextRef(), "en")]);

    const row = await db.consent.findFirstOrThrow();
    expect(row).toMatchObject({
      language: "en",
      textShownIsCurated: false,
      linkShown: "https://kubri.it/privacy",
    });
    expect(row.textShown).toContain("https://kubri.it/privacy");
  });

  it("records a refused kubri_global as not shared", async () => {
    await run([consent("kubri_global", "declined")]);

    expect(
      (await db.candidateProfile.findUniqueOrThrow({ where: { sessionId } })).sharedWithGlobal,
    ).toBe(false);
  });

  it("sets the language, completes the profile and reports it", async () => {
    const outcome = await run([
      { type: "SetLanguage", language: "ar" },
      { type: "CompleteSession", at: AT },
    ]);

    expect(outcome).toMatchObject({ language: "ar", completed: true, stopped: false });
    expect(
      (await db.contact.findUniqueOrThrow({ where: { id: scenario.contactId } })).preferredLanguage,
    ).toBe("ar");
    expect(
      (await db.candidateProfile.findUniqueOrThrow({ where: { sessionId } })).completedAt,
    ).toEqual(new Date(AT));
  });

  it("marks the turn's inbound messages processed with their redacted copy only", async () => {
    const id = await inbound("mi chiamo Mario");

    await run([firstName], { inbound: [{ id, bodyRedacted: "mi chiamo [firstName]" }] });

    expect(await db.message.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "processed",
      sessionId,
      turnId: TURN_ID,
      body: "mi chiamo Mario",
      bodyRedacted: "mi chiamo [firstName]",
    });
  });

  it("purges the data on StopSession with the delete policy, keeping the goodbye and the consent", async () => {
    const id = await inbound("no, mi chiamo Mario");

    const outcome = await run(
      [
        firstName,
        consent("privacy_interview", "declined"),
        { type: "SendText", text: systemText("system.stopped") },
        { type: "StopSession", reason: "consent_declined", dataPolicy: "delete", at: AT },
      ],
      { inbound: [{ id, bodyRedacted: "no, mi chiamo [firstName]" }], answeringMessageId: id },
    );

    expect(outcome).toMatchObject({ stopped: true, purged: true });
    expect((await loadProfile(db, sessionId)).standard).toEqual({});
    expect(await db.profileChange.count()).toBe(0);
    expect(await db.consent.count()).toBe(1);
    // The current turn's own message is purged too (it got its session before the purge).
    expect(await db.message.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "processed",
      body: null,
      bodyRedacted: null,
      payloadRaw: null,
    });
    const goodbye = await db.message.findFirstOrThrow({ where: { direction: "outbound" } });
    expect(goodbye.body).toContain("l'intervista finisce qui");
  });

  it("keeps the data on StopSession with the keep policy", async () => {
    const outcome = await run([
      firstName,
      { type: "StopSession", reason: "flow_stop", dataPolicy: "keep", at: AT },
    ]);

    expect(outcome).toMatchObject({ stopped: true, purged: false });
    expect((await loadProfile(db, sessionId)).standard).toEqual({ firstName: "Mario" });
  });

  it("records an opt-out on the channel state", async () => {
    await run([{ type: "OptOut", at: AT }]);

    expect(await db.contactChannelState.findFirstOrThrow()).toMatchObject({
      optInStatus: "opted_out",
      optOutAt: new Date(AT),
    });
  });

  it("enqueues every kind of job inside the transaction", async () => {
    await run([
      { type: "EnqueueJob", job: { name: "kubri-webhook", event: "consents.accepted" } },
      { type: "EnqueueJob", job: { name: "cv" } },
      { type: "EnqueueJob", job: { name: "geocoding" } },
      { type: "EnqueueJob", job: { name: "delete-contact" } },
    ]);

    expect(queue.jobs.map((j) => [j.name, j.payload, j.inTransaction])).toEqual([
      ["kubri-webhook", { sessionId, event: "consents.accepted" }, true],
      ["cv", { sessionId }, true],
      ["geocoding", { sessionId }, true],
      ["delete-contact", { contactId: scenario.contactId }, true],
    ]);
  });

  it("records a flag and moves the session to needs_attention (stale_confirmation too)", async () => {
    const outcome = await run([
      { type: "FlagSession", reason: "unresolved_field", needsAttention: false, field: "email" },
      { type: "FlagSession", reason: "stale_confirmation", needsAttention: true },
    ]);

    expect(outcome.needsAttention).toBe(true);
    expect(
      (await db.sessionFlag.findMany({ orderBy: { createdAt: "asc" } })).map((f) => [
        f.reason,
        f.field,
        f.needsAttention,
        f.turnId,
      ]),
    ).toEqual([
      ["unresolved_field", "email", false, TURN_ID],
      ["stale_confirmation", null, true, TURN_ID],
    ]);
    expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe(
      "needs_attention",
    );
  });

  it("leaves the session active for a flag that needs no attention", async () => {
    const outcome = await run([
      { type: "FlagSession", reason: "unresolved_field", needsAttention: false, field: "email" },
    ]);

    expect(outcome.needsAttention).toBe(false);
    expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe(
      "active",
    );
  });

  it("only logs the rejections of a patch", async () => {
    await run([
      { type: "RecordPatchRejections", rejected: [{ field: "colour", reason: "unknown_field" }] },
    ]);

    expect(await db.profileChange.count()).toBe(0);
  });
});
