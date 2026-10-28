import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importCampaign } from "../../src/campaigns/import";
import { initialSessionState } from "../../src/engine/state";
import { encodeState } from "../../src/runtime/state-codec";
import { contactHash, insertConsent } from "../../src/store/consents";
import { upsertContact } from "../../src/store/contacts";
import { createSession } from "../../src/store/sessions";
import { insertFlag, insertTurn } from "../../src/store/turns";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { loadStandardCampaign, seedRegistry } from "./helpers/registry";

const db = createTestDatabase();
let sessionId = "";
let contactId = "";

beforeEach(async () => {
  await resetBotSchema(db);
  const { sender } = await seedRegistry(db);
  const imported = await importCampaign(db, loadStandardCampaign(), {
    activate: true,
    nodeEnv: "development",
  });
  if (!imported.ok) throw new Error("import failed");
  contactId = (
    await upsertContact(db, {
      channel: "whatsapp",
      externalId: "3933311",
      phoneE164: "+393331112233",
    })
  ).id;
  sessionId = (
    await createSession(db, {
      contactId,
      senderNumberId: sender.id,
      campaignVersionId: imported.versionId,
      state: encodeState(initialSessionState()),
      at: new Date(),
    })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("contactHash", () => {
  it("is a stable sha256 of channel and external id", () => {
    expect(contactHash("whatsapp", "3933311")).toMatch(/^[0-9a-f]{64}$/);
    expect(contactHash("whatsapp", "3933311")).toBe(contactHash("whatsapp", "3933311"));
    expect(contactHash("whatsapp", "3933311")).not.toBe(contactHash("whatsapp", "3933312"));
  });
});

describe("consents", () => {
  it("copies the text shown and the proof of the contact", async () => {
    await insertConsent(db, {
      contactId,
      channel: "whatsapp",
      externalId: "3933311",
      sessionId,
      consentKey: "privacy_interview",
      textVersion: "placeholder-2026-10",
      language: "en",
      textShown: "[en] Accetti?",
      textShownIsCurated: false,
      linkShown: "https://kubri.it/privacy",
      dataController: { name: "Kubri", privacyUrl: "https://kubri.it/privacy" },
      outcome: "accepted",
      messageId: null,
      decidedAt: new Date("2026-10-24T10:00:00Z"),
    });

    expect(await db.consent.findFirstOrThrow()).toMatchObject({
      contactId,
      sessionId,
      consentKey: "privacy_interview",
      textShown: "[en] Accetti?",
      textShownIsCurated: false,
      linkShown: "https://kubri.it/privacy",
      outcome: "accepted",
      contactHash: contactHash("whatsapp", "3933311"),
    });
  });
});

describe("turns and flags", () => {
  it("stores a turn with an id chosen in advance and its inbound message ids", async () => {
    const id = "6f1c5f0e-3b8a-4a43-9d6e-5d0b6f7d2a11";

    await insertTurn(db, {
      id,
      contactId,
      sessionId,
      inboundMessageIds: [],
      startedAt: new Date("2026-10-24T10:00:00Z"),
      completedAt: new Date("2026-10-24T10:00:03Z"),
      outcome: "replied",
    });

    expect(await db.turn.findUniqueOrThrow({ where: { id } })).toMatchObject({
      outcome: "replied",
      sessionId,
      contactId,
    });
  });

  it("records a flag with its reason and field", async () => {
    await insertFlag(db, {
      sessionId,
      turnId: null,
      reason: "unresolved_field",
      field: "email",
      needsAttention: false,
    });

    expect(await db.sessionFlag.findFirstOrThrow()).toMatchObject({
      reason: "unresolved_field",
      field: "email",
      needsAttention: false,
    });
  });
});
