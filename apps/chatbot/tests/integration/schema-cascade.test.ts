import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { loadStandardCampaign, seedRegistry } from "./helpers/registry";
import { importCampaign } from "../../src/campaigns/import";

const db = createTestDatabase();

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function seedSession() {
  const { sender } = await seedRegistry(db);
  const imported = await importCampaign(db, loadStandardCampaign(), {
    activate: true,
    nodeEnv: "development",
  });
  if (!imported.ok) throw new Error("import failed");
  const contact = await db.contact.create({
    data: { channel: "whatsapp", externalId: "393331112233", phoneE164: "+393331112233" },
  });
  const session = await db.session.create({
    data: {
      contactId: contact.id,
      senderNumberId: sender.id,
      campaignVersionId: imported.versionId,
      engineState: {},
      openKey: `${contact.id}:${sender.id}`,
      profile: { create: {} },
    },
  });
  return { sender, contact, session };
}

describe("runtime schema (D109)", () => {
  it("allows one open session per contact and number, and many closed ones", async () => {
    const { sender, contact, session } = await seedSession();

    await expect(
      db.session.create({
        data: {
          contactId: contact.id,
          senderNumberId: sender.id,
          campaignVersionId: session.campaignVersionId,
          engineState: {},
          openKey: `${contact.id}:${sender.id}`,
        },
      }),
    ).rejects.toThrow();
    await db.session.createMany({
      data: [1, 2].map(() => ({
        contactId: contact.id,
        senderNumberId: sender.id,
        campaignVersionId: session.campaignVersionId,
        engineState: {},
        status: "stopped" as const,
      })),
    });
    expect(await db.session.count()).toBe(3);
  });

  it("deleting a contact removes its data but keeps the consent proof", async () => {
    const { contact, session } = await seedSession();
    const turn = await db.turn.create({
      data: {
        sessionId: session.id,
        inboundMessageIds: [],
        startedAt: new Date(),
        completedAt: new Date(),
        outcome: "replied",
      },
    });
    await db.message.create({
      data: {
        contactId: contact.id,
        senderNumberId: session.senderNumberId,
        sessionId: session.id,
        turnId: turn.id,
        direction: "inbound",
        type: "text",
        body: "ciao",
        status: "processed",
      },
    });
    await db.consent.create({
      data: {
        contactId: contact.id,
        contactHash: "hash-1",
        sessionId: session.id,
        consentKey: "privacy_interview",
        textVersion: "placeholder-2026-10",
        language: "it",
        textShown: "testo",
        textShownIsCurated: true,
        dataController: { name: "Kubri" },
        outcome: "accepted",
        decidedAt: new Date(),
      },
    });

    await db.contact.delete({ where: { id: contact.id } });

    expect(await db.session.count()).toBe(0);
    expect(await db.message.count()).toBe(0);
    expect(await db.candidateProfile.count()).toBe(0);
    const consents = await db.consent.findMany();
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({ contactId: null, sessionId: null, contactHash: "hash-1" });
  });
});
