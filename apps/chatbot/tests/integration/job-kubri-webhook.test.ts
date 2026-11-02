import { CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE } from "@kubri/contracts";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FakeKubriClient } from "../../src/integrations/kubri/client";
import { TransientJobError } from "../../src/runtime/jobs/errors";
import { handleKubriWebhook, type KubriJobDeps } from "../../src/runtime/jobs/kubri-webhook";
import { MemoryJobQueue } from "../../src/runtime/memory-queue";
import type { KubriEvent } from "../../src/engine/effects";
import { applyProfileFields, purgeSessionData } from "../../src/store/profiles";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedScenario, silentLogger, startSession, type Scenario } from "./helpers/runtime";

const db = createTestDatabase();
let s: Scenario;
let sessionId = "";
let kubri: FakeKubriClient;
let queue: MemoryJobQueue;

const NOT_LAST = { retryCount: 0, lastAttempt: false } as const;
const LAST = { retryCount: 10, lastAttempt: true } as const;

const deps = (): KubriJobDeps => ({ db, logger: silentLogger, queue, kubri });
const job = (event: KubriEvent = "consents.accepted") => ({ sessionId, event });
const flags = () => db.sessionFlag.findMany({ where: { sessionId } });

/** Closing a session: the status and the open key together (Session_openKey_status_check). */
const stop = () =>
  db.session.update({ where: { id: sessionId }, data: { status: "stopped", openKey: null } });

beforeEach(async () => {
  await resetBotSchema(db);
  s = await seedScenario(db);
  sessionId = (await startSession(s)).id;
  kubri = new FakeKubriClient();
  queue = new MemoryJobQueue();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("handleKubriWebhook (D125, D126, R7)", () => {
  it("creates the candidate at the consent threshold, even with an empty profile (D24)", async () => {
    expect(await handleKubriWebhook(deps(), job(), NOT_LAST)).toBe("sent");

    expect(kubri.sent).toHaveLength(1);
    expect(kubri.sent[0]).toMatchObject({
      key: `${s.contactId}:${s.campaign?.campaignId ?? ""}`,
      externalKey: "global",
      data: {
        channel: "whatsapp",
        interview_status: "in_progress",
        phone: s.phone,
        source_organization: "kubri-chatbot",
      },
    });
  });

  it("sends the profile as it is now, whatever the event that triggered the job", async () => {
    await applyProfileFields(db, sessionId, "extraction", null, [
      { field: "firstName", value: "Karim", confidence: 0.95, status: "inferred" },
      { field: "birthday", value: "1990-05-12", confidence: 0.95, status: "inferred" },
    ]);
    const { updatedAt } = await db.candidateProfile.findUniqueOrThrow({ where: { sessionId } });

    await handleKubriWebhook(deps(), job("interview.completed"), NOT_LAST);

    expect(kubri.sent[0]?.data).toMatchObject({
      first_name: "Karim",
      birthday: "12/05/1990",
      last_updated: updatedAt.toISOString(),
    });
  });

  it("matches the shared contract example field by field through the real database (§14)", async () => {
    const e = CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE.data;
    await applyProfileFields(db, sessionId, "extraction", null, [
      { field: "firstName", value: e.first_name, confidence: 0.95, status: "inferred" },
      { field: "country", value: e.country, confidence: 0.95, status: "inferred" },
      {
        field: "drivingLicenseTypes",
        value: e.driving_license_types,
        confidence: 0.9,
        status: "inferred",
      },
    ]);

    await handleKubriWebhook(deps(), job(), NOT_LAST);

    expect(kubri.sent[0]?.data).toMatchObject({
      first_name: e.first_name,
      country: e.country,
      driving_license_types: e.driving_license_types,
    });
  });

  it("skips a session that no longer exists", async () => {
    await db.contact.delete({ where: { id: s.contactId } });

    expect(await handleKubriWebhook(deps(), job(), NOT_LAST)).toBe("skipped");
    expect(kubri.sent).toEqual([]);
  });

  it("never overwrites a candidate with the emptied profile of a deletion (opt-out with delete)", async () => {
    await applyProfileFields(db, sessionId, "extraction", null, [
      { field: "firstName", value: "Karim", confidence: 0.95, status: "inferred" },
    ]);
    await purgeSessionData(db, sessionId);
    await stop();

    expect(await handleKubriWebhook(deps(), job("profile.updated"), NOT_LAST)).toBe("skipped");
    expect(kubri.sent).toEqual([]);
  });

  it("still sends a stopped session whose data was kept", async () => {
    await applyProfileFields(db, sessionId, "extraction", null, [
      { field: "firstName", value: "Karim", confidence: 0.95, status: "inferred" },
    ]);
    await stop();

    expect(await handleKubriWebhook(deps(), job(), NOT_LAST)).toBe("sent");
    expect(kubri.sent[0]?.data).toMatchObject({ interview_status: "stopped" });
  });

  it("counts a send the dashboard skipped as stale as done", async () => {
    kubri = new FakeKubriClient([{ ok: true, skipped: "stale" }]);

    expect(await handleKubriWebhook(deps(), job(), NOT_LAST)).toBe("sent");
    expect(queue.deadLetters).toEqual([]);
  });

  it("asks pg-boss for a retry on a transient failure, without flagging", async () => {
    kubri = new FakeKubriClient([{ ok: false, kind: "transient", code: "http_503", status: 503 }]);

    await expect(handleKubriWebhook(deps(), job(), NOT_LAST)).rejects.toThrow(TransientJobError);
    expect(queue.deadLetters).toEqual([]);
    expect(await flags()).toEqual([]);
  });

  it("gives up like a definitive failure when the last attempt fails for now (D126)", async () => {
    kubri = new FakeKubriClient([{ ok: false, kind: "transient", code: "http_503", status: 503 }]);

    expect(await handleKubriWebhook(deps(), job(), LAST)).toBe("dead");

    expect(queue.deadLetters).toEqual([
      { name: "kubri-webhook", payload: job(), reason: "http_503" },
    ]);
    expect(await flags()).toMatchObject([
      { reason: "kubri_webhook_failed", needsAttention: false, turnId: null },
    ]);
    const session = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("active");
  });

  it.each(["unauthorized", "validation_failed", "unknown_pool"])(
    "sends a definitive %s to the dead letter queue at once and flags the session",
    async (code) => {
      kubri = new FakeKubriClient([{ ok: false, kind: "permanent", code, status: 400 }]);

      expect(await handleKubriWebhook(deps(), job(), NOT_LAST)).toBe("dead");

      expect(queue.deadLetters).toEqual([{ name: "kubri-webhook", payload: job(), reason: code }]);
      expect(await flags()).toMatchObject([
        { reason: "kubri_webhook_failed", needsAttention: false, turnId: null },
      ]);
      const session = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe("active");
    },
  );

  it("sends every job to the dead letter queue when Kubri is not configured (R9, development)", async () => {
    expect(await handleKubriWebhook({ ...deps(), kubri: null }, job(), NOT_LAST)).toBe("dead");

    expect(queue.deadLetters).toEqual([
      { name: "kubri-webhook", payload: job(), reason: "not_configured" },
    ]);
    // A worker without Kubri is a setup choice, not a problem of the session.
    expect(await flags()).toEqual([]);
  });

  it("treats a payload that breaks the contract as definitive, without calling Kubri", async () => {
    await applyProfileFields(db, sessionId, "extraction", null, [
      { field: "country", value: "Marocco", confidence: 0.95, status: "inferred" },
    ]);

    expect(await handleKubriWebhook(deps(), job(), NOT_LAST)).toBe("dead");

    expect(kubri.sent).toEqual([]);
    expect(queue.deadLetters).toEqual([
      { name: "kubri-webhook", payload: job(), reason: "contract" },
    ]);
    expect(await flags()).toMatchObject([{ reason: "kubri_webhook_failed" }]);
  });
});
