import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma/client";
import { sourceHash } from "../../src/i18n/translation-cache";
import type { NluTraceRecord } from "../../src/nlu/trace";
import {
  createDatabaseTraceSink,
  createDatabaseTranslationCache,
  insertTraces,
  toTraceRows,
} from "../../src/store/traces";
import { createTestDatabase, resetBotSchema } from "./helpers/database";

const db = createTestDatabase();

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const record = (
  attempt: NluTraceRecord["attempt"],
  overrides: Partial<NluTraceRecord> = {},
): NluTraceRecord => ({
  turnId: null,
  task: "translate",
  promptVersion: "translate-v1",
  provider: "fake",
  model: "m",
  attempt,
  repair: false,
  input: [{ role: "user", content: "Sezione {current}" }],
  output: '{"text":"x"}',
  valid: true,
  latencyMs: 12.4,
  inputTokens: 10,
  outputTokens: 5,
  costEstimate: 0.0001,
  error: null,
  at: "2026-10-24T10:00:00.000Z",
  ...overrides,
});

describe("toTraceRows (D110)", () => {
  it("keeps the input only on the first call of each chain", () => {
    const rows = toTraceRows([
      record("primary"),
      record("retry"),
      record("fallback"),
      record("primary", { repair: true }),
      record("retry", { repair: true }),
    ]);

    expect(rows.map((r) => r.input !== null)).toEqual([true, false, false, true, false]);
    expect(rows[0]).toMatchObject({
      latencyMs: 12,
      createdAt: new Date("2026-10-24T10:00:00.000Z"),
    });
  });
});

describe("database trace sink", () => {
  it("stores a dropped input as SQL NULL, not as JSON null", async () => {
    await createDatabaseTraceSink(db).write(record("retry"));

    expect(await db.nluTrace.count({ where: { input: { equals: Prisma.DbNull } } })).toBe(1);
  });

  it("writes a translation trace with no turn", async () => {
    await createDatabaseTraceSink(db).write(record("primary"));

    expect(await db.nluTrace.findFirstOrThrow()).toMatchObject({
      turnId: null,
      task: "translate",
      model: "m",
      valid: true,
    });
  });

  it("writes the turn's traces inside its transaction", async () => {
    const { sender } = await (await import("./helpers/registry")).seedRegistry(db);
    const { importCampaign } = await import("../../src/campaigns/import");
    const { loadStandardCampaign } = await import("./helpers/registry");
    const imported = await importCampaign(db, loadStandardCampaign(), {
      activate: true,
      nodeEnv: "development",
    });
    if (!imported.ok) throw new Error("import failed");
    const contact = await db.contact.create({
      data: { channel: "whatsapp", externalId: "1", phoneE164: "+391" },
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
    const turnId = "6f1c5f0e-3b8a-4a43-9d6e-5d0b6f7d2a11";
    await db.turn.create({
      data: {
        id: turnId,
        sessionId: session.id,
        inboundMessageIds: [],
        startedAt: new Date(),
        completedAt: new Date(),
        outcome: "replied",
      },
    });

    await insertTraces(db, [record("primary", { task: "interpret", turnId })]);

    expect(await db.nluTrace.findFirstOrThrow()).toMatchObject({ turnId, task: "interpret" });
  });
});

describe("database translation cache", () => {
  it("stores and reads translations by source hash and language", async () => {
    const cache = createDatabaseTranslationCache(db);
    const hash = sourceHash("Accetti?");

    expect(await cache.get(hash, "en")).toBeUndefined();
    await cache.set(hash, "en", {
      text: "Do you accept?",
      reviewed: false,
      provider: "mistral",
      model: "m",
    });
    await cache.set(hash, "en", {
      text: "Do you agree?",
      reviewed: true,
      provider: "mistral",
      model: "m",
    });

    expect(await cache.get(hash, "en")).toEqual({
      text: "Do you agree?",
      reviewed: true,
      provider: "mistral",
      model: "m",
    });
    expect(await cache.get(hash, "fr")).toBeUndefined();
  });
});
