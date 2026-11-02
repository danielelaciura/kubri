import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyProfileFields, setSharedWithGlobal } from "../../src/store/profiles";
import { loadSnapshot } from "../../src/store/snapshot";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedScenario, startSession, type Scenario } from "./helpers/runtime";

const db = createTestDatabase();
let s: Scenario;
let sessionId = "";

beforeEach(async () => {
  await resetBotSchema(db);
  s = await seedScenario(db);
  sessionId = (await startSession(s)).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("loadSnapshot (R5)", () => {
  it("is null for a session that does not exist (it was deleted)", async () => {
    expect(await loadSnapshot(db, "6f1c5f0e-3b8a-4a43-9d6e-5d0b6f7d2a11")).toBeNull();
  });

  it("reads the contact, the campaign, the session and the profile", async () => {
    await applyProfileFields(db, sessionId, "extraction", null, [
      { field: "firstName", value: "Mario", confidence: 0.95, status: "inferred" },
      { field: "custom.night_shifts", value: true, confidence: 0.9, status: "inferred" },
    ]);
    await setSharedWithGlobal(db, sessionId, true);

    const snapshot = await loadSnapshot(db, sessionId);

    expect(snapshot).toMatchObject({
      sessionId,
      contact: {
        id: s.contactId,
        channel: "whatsapp",
        externalId: s.externalId,
        phoneE164: s.phone,
      },
      campaign: { externalKey: "global", version: 1 },
      session: { status: "active", language: null, senderNumberId: s.senderId },
      profile: {
        standard: { firstName: "Mario" },
        custom: { night_shifts: true },
        sharedWithGlobal: true,
      },
    });
    expect(snapshot?.campaign.id).toBe(s.campaign?.campaignId);
    expect(snapshot?.campaign.versionId).toBe(s.campaign?.versionId);
    expect(snapshot?.profile.updatedAt).toBeInstanceOf(Date);
    expect(snapshot?.profile.fieldMeta["firstName"]).toMatchObject({ status: "inferred" });
  });
});
