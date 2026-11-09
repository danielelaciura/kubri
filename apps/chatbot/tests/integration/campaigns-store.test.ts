import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalCampaign } from "../../src/campaigns/checksum";
import { CampaignDefinitionSchema, type CampaignInput } from "../../src/campaigns/schema/campaign";
import {
  findActiveCampaignByKeyword,
  findCampaignVersion,
  findDefaultCampaign,
  listCampaigns,
  saveCampaignVersion,
} from "../../src/store/campaigns";
import { minimalCampaign } from "../unit/campaigns/fixtures";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedRegistry } from "./helpers/registry";

const db = createTestDatabase();
let senderId = "";

beforeEach(async () => {
  await resetBotSchema(db);
  senderId = (await seedRegistry(db)).sender.id;
});

afterAll(async () => {
  await db.$disconnect();
});

function save(input: CampaignInput, activate: boolean) {
  const definition = CampaignDefinitionSchema.parse(input);
  const { json, checksum } = canonicalCampaign(definition);
  return saveCampaignVersion(db, {
    definition,
    canonical: json,
    checksum,
    activate,
    importedBy: "test",
  });
}

describe("saveCampaignVersion", () => {
  it("creates the campaign and version 1, paused unless activated", async () => {
    const result = await save(minimalCampaign(), false);

    expect(result).toMatchObject({ ok: true, outcome: "created", version: 1, active: false });
    expect(await listCampaigns(db)).toEqual([
      {
        slug: "acme-magazzino",
        organizationSlug: "acme",
        senderSlug: "kubri-main",
        status: "paused",
        isDefault: false,
        keywords: ["acme"],
        activeVersion: null,
        latestVersion: 1,
      },
    ]);
  });

  it("stores the canonical definition and its checksum", async () => {
    const result = await save(minimalCampaign(), false);
    if (!result.ok) throw new Error("expected ok");

    const row = await db.campaignVersion.findUniqueOrThrow({ where: { id: result.versionId } });
    const expected = canonicalCampaign(CampaignDefinitionSchema.parse(minimalCampaign()));

    expect(row.checksum).toBe(expected.checksum);
    expect(row.definition).toEqual(expected.json);
    expect(row.importedBy).toBe("test");
  });

  it("returns the loaded campaign by version id", async () => {
    const result = await save(minimalCampaign(), false);
    if (!result.ok) throw new Error("expected ok");

    const loaded = await findCampaignVersion(db, result.versionId);

    expect(loaded).toMatchObject({
      versionId: result.versionId,
      campaignId: result.campaignId,
      campaignSlug: "acme-magazzino",
      version: 1,
    });
    expect(loaded?.definition).toEqual(CampaignDefinitionSchema.parse(minimalCampaign()));
  });

  it("finds an active campaign by keyword and the default campaign", async () => {
    await save(minimalCampaign(), true);
    const standard = minimalCampaign();
    standard.campaign = "kubri-standard";
    standard.organization = "kubri";
    standard.trigger = { sender: "kubri-main", keywords: [], isDefault: true };
    await save(standard, true);

    expect((await findActiveCampaignByKeyword(db, senderId, " ACME "))?.campaignSlug).toBe(
      "acme-magazzino",
    );
    expect(await findActiveCampaignByKeyword(db, senderId, "culligan")).toBeNull();
    expect((await findDefaultCampaign(db, senderId))?.campaignSlug).toBe("kubri-standard");
  });

  it("does not route to paused campaigns", async () => {
    await save(minimalCampaign(), false);

    expect(await findActiveCampaignByKeyword(db, senderId, "acme")).toBeNull();
  });

  it("reports an unknown organization or sender without writing anything", async () => {
    const noOrg = minimalCampaign();
    noOrg.organization = "nobody";
    const noSender = minimalCampaign();
    noSender.trigger = { sender: "nowhere", keywords: ["acme"] };

    expect(await save(noOrg, false)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ path: "organization", code: "unknown_organization" })],
    });
    expect(await save(noSender, false)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ path: "trigger.sender", code: "unknown_sender" })],
    });
    expect(await db.campaign.count()).toBe(0);
  });

  it("refuses to move a campaign to another organization", async () => {
    await save(minimalCampaign(), false);
    const moved = minimalCampaign();
    moved.organization = "kubri";

    expect(await save(moved, false)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "organization_mismatch" })],
    });
  });
});
