import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { importCampaign } from "../../src/campaigns/import";
import { findDefaultCampaign, listCampaigns } from "../../src/store/campaigns";
import { minimalCampaign } from "../unit/campaigns/fixtures";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { loadStandardCampaign, seedRegistry } from "./helpers/registry";

const db = createTestDatabase();
let senderId = "";

beforeEach(async () => {
  await resetBotSchema(db);
  senderId = (await seedRegistry(db)).sender.id;
});

afterAll(async () => {
  await db.$disconnect();
});

const DEV = { activate: true, nodeEnv: "development" } as const;

describe("importCampaign", () => {
  it("imports and activates the standard Kubri campaign", async () => {
    const result = await importCampaign(db, loadStandardCampaign(), DEV);

    expect(result).toMatchObject({ ok: true, outcome: "created", version: 1, active: true });
    expect((await findDefaultCampaign(db, senderId))?.definition.externalKey).toBe("global");
  });

  it("warns about placeholder consents outside production", async () => {
    const result = await importCampaign(db, loadStandardCampaign(), DEV);

    expect(result.ok && result.warnings.map((w) => w.code)).toEqual([
      "placeholder_consent",
      "placeholder_consent",
    ]);
  });

  it("refuses placeholder consents in production, writing nothing", async () => {
    const result = await importCampaign(db, loadStandardCampaign(), {
      activate: true,
      nodeEnv: "production",
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((i) => i.code)).toEqual([
      "placeholder_consent",
      "placeholder_consent",
    ]);
    expect(await db.campaign.count()).toBe(0);
  });

  it("accepts official consent versions in production", async () => {
    const result = await importCampaign(db, minimalCampaign(), {
      activate: true,
      nodeEnv: "production",
    });

    expect(result).toMatchObject({ ok: true, version: 1 });
  });

  it("does not create a new version for an identical re-import", async () => {
    await importCampaign(db, loadStandardCampaign(), DEV);

    const again = await importCampaign(db, loadStandardCampaign(), DEV);

    expect(again).toMatchObject({ ok: true, outcome: "unchanged", version: 1, active: true });
    expect(await db.campaignVersion.count()).toBe(1);
  });

  it("creates version 2 when the file changes", async () => {
    await importCampaign(db, loadStandardCampaign(), DEV);
    const changed = loadStandardCampaign();
    changed.afterCompletion = { allowEdits: true, allowCvRegeneration: false };

    const result = await importCampaign(db, changed, DEV);

    expect(result).toMatchObject({ ok: true, outcome: "created", version: 2, active: true });
    expect(await db.campaignVersion.count()).toBe(2);
  });

  it("keeps the active version when a new one is imported without activation", async () => {
    await importCampaign(db, loadStandardCampaign(), DEV);
    const changed = loadStandardCampaign();
    changed.afterCompletion = { allowEdits: false, allowCvRegeneration: false };

    const result = await importCampaign(db, changed, { activate: false, nodeEnv: "development" });

    expect(result).toMatchObject({ ok: true, outcome: "created", version: 2, active: false });
    const [summary] = await listCampaigns(db);
    expect(summary).toMatchObject({ status: "active", activeVersion: 1, latestVersion: 2 });
    expect((await findDefaultCampaign(db, senderId))?.version).toBe(1);
  });

  it("re-activates an older version when its file is imported again (rollback)", async () => {
    await importCampaign(db, loadStandardCampaign(), DEV);
    const changed = loadStandardCampaign();
    changed.afterCompletion = { allowEdits: false, allowCvRegeneration: false };
    await importCampaign(db, changed, DEV);

    const rollback = await importCampaign(db, loadStandardCampaign(), DEV);

    expect(rollback).toMatchObject({ ok: true, outcome: "unchanged", version: 1, active: true });
    expect((await findDefaultCampaign(db, senderId))?.version).toBe(1);
  });

  it("rejects a keyword already used by another active campaign on the same sender", async () => {
    await importCampaign(db, minimalCampaign(), DEV);
    const rival = minimalCampaign();
    rival.campaign = "acme-pulizie";
    rival.trigger = { sender: "kubri-main", keywords: ["pulizie", "acme"] };

    const result = await importCampaign(db, rival, DEV);

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ path: "trigger.keywords[1]", code: "keyword_collision" })],
    });
    expect(await db.campaign.count()).toBe(1);
  });

  it("ignores keywords of paused campaigns", async () => {
    await importCampaign(db, minimalCampaign(), { activate: false, nodeEnv: "development" });
    const rival = minimalCampaign();
    rival.campaign = "acme-pulizie";

    expect(await importCampaign(db, rival, DEV)).toMatchObject({ ok: true, active: true });
  });

  it("rejects a second default campaign on the same sender", async () => {
    await importCampaign(db, loadStandardCampaign(), DEV);
    const second = loadStandardCampaign();
    second.campaign = "kubri-standard-bis";

    const result = await importCampaign(db, second, DEV);

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({ path: "trigger.isDefault", code: "duplicate_default_campaign" }),
      ],
    });
  });

  it("never writes an invalid campaign", async () => {
    const invalid = minimalCampaign();
    invalid.flow = invalid.flow.filter((step) => step.type !== "consent");

    const result = await importCampaign(db, invalid, DEV);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.map((i) => i.code)).toContain("missing_mandatory_consent");
    expect(await db.campaign.count()).toBe(0);
    expect(await db.campaignVersion.count()).toBe(0);
  });
});
