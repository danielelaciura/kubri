import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createOrganization, findOrganizationBySlug } from "../../src/store/organizations";
import {
  createSenderNumber,
  findOutboundSender,
  findSenderNumberByPhone,
  findSenderNumberBySlug,
} from "../../src/store/senders";
import { createTestDatabase, resetBotSchema } from "./helpers/database";

const db = createTestDatabase();

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const META_CONFIG = {
  phoneNumberId: "123456789012345",
  wabaId: "987654321098765",
  accessTokenSecret: "META_TOKEN_KUBRI_MAIN",
};

describe("organizations store", () => {
  it("creates and finds an organization by slug", async () => {
    const created = await createOrganization(db, { slug: "kubri", name: "Kubri S.r.l." });

    expect(await findOrganizationBySlug(db, "kubri")).toEqual(created);
    expect(await findOrganizationBySlug(db, "missing")).toBeNull();
  });
});

describe("senders store", () => {
  it("creates a Meta sender number and finds it by slug and phone", async () => {
    const org = await createOrganization(db, { slug: "kubri", name: "Kubri S.r.l." });

    const created = await createSenderNumber(db, {
      slug: "kubri-main",
      organizationId: org.id,
      phoneE164: "+393331234567",
      displayName: "Kubri",
      status: "active",
      provider: "meta",
      providerConfig: META_CONFIG,
    });

    expect(created).toMatchObject({ slug: "kubri-main", provider: "meta", status: "active" });
    expect(await findSenderNumberBySlug(db, "kubri-main")).toEqual(created);
    expect(await findSenderNumberByPhone(db, "+393331234567")).toEqual(created);
  });

  it("stores the provider config (identifiers and secret names only)", async () => {
    await createSenderNumber(db, {
      slug: "kubri-main",
      organizationId: null,
      phoneE164: "+393331234567",
      displayName: "Kubri",
      status: "active",
      provider: "meta",
      providerConfig: META_CONFIG,
    });

    const row = await db.senderNumber.findUniqueOrThrow({ where: { slug: "kubri-main" } });

    expect(row.providerConfig).toEqual(META_CONFIG);
    expect(row.channel).toBe("whatsapp");
  });
});

describe("findOutboundSender", () => {
  it("returns what a channel adapter needs, config included", async () => {
    const created = await createSenderNumber(db, {
      slug: "kubri-main",
      organizationId: null,
      phoneE164: "+390212345678",
      displayName: "Kubri",
      status: "active",
      provider: "meta",
      providerConfig: META_CONFIG,
    });

    expect(await findOutboundSender(db, created.id)).toEqual({
      id: created.id,
      slug: "kubri-main",
      provider: "meta",
      providerConfig: META_CONFIG,
    });
  });
});
