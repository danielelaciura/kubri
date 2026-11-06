import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { pino } from "pino";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { signBody } from "../../src/channels/meta-cloud/signature";
import { createWebhookServer } from "../../src/ingress/server";
import type { WebhookDeps } from "../../src/ingress/webhook";
import { MemoryJobQueue } from "../../src/runtime/memory-queue";
import { reportOutboundFailure } from "../../src/runtime/outbound-failure";
import { claimNextOutbound, finishSend, queueOutbound } from "../../src/store/messages";
import { createDatabase } from "../../src/store/db";
import { testDatabaseUrl, createTestDatabase, resetBotSchema } from "./helpers/database";
import { seedScenario, startSession, testConfig, type Scenario } from "./helpers/runtime";

const db = createTestDatabase();
const SECRET = "app-secret";
const TOKEN = "verify-me";
const fixture = (name: string): string =>
  readFileSync(join(__dirname, "../fixtures/meta", `${name}.json`), "utf8");

let queue: MemoryJobQueue;
let scenario: Scenario;
let server: ReturnType<typeof createWebhookServer> | undefined;

async function start(overrides: Partial<WebhookDeps> = {}): Promise<string> {
  const deps: WebhookDeps = {
    db,
    queue,
    config: testConfig({ DEBOUNCE_MS: "3000" }),
    logger: pino({ level: "silent" }),
    appSecret: SECRET,
    verifyToken: TOKEN,
    now: () => new Date(),
    ...overrides,
  };
  server = createWebhookServer(deps);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  await resetBotSchema(db);
  scenario = await seedScenario(db);
  queue = new MemoryJobQueue();
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server) {
      server.close(() => {
        resolve();
      });
    } else {
      resolve();
    }
  });
  server = undefined;
});

afterAll(async () => {
  await db.$disconnect();
});

const post = (
  base: string,
  body: string,
  signature: string | null = signBody(SECRET, Buffer.from(body)),
) =>
  fetch(`${base}/webhooks/whatsapp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-hub-signature-256": signature } : {}),
    },
    body,
  });

describe("verification and health", () => {
  it("answers Meta's verification with the challenge, and refuses a wrong token", async () => {
    const base = await start();

    const ok = await fetch(
      `${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=1158201444`,
    );
    const bad = await fetch(
      `${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`,
    );

    expect([ok.status, await ok.text()]).toEqual([200, "1158201444"]);
    expect(bad.status).toBe(403);
  });

  it("answers /health, and 404 elsewhere", async () => {
    const base = await start();

    const health = await fetch(`${base}/health`);
    expect([health.status, await health.json()]).toEqual([200, { status: "ok" }]);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("reports an unhealthy database on /health with 503", async () => {
    const down = createDatabase("postgresql://postgres:postgres@127.0.0.1:1/none?schema=bot");
    const base = await start({ db: down });

    expect((await fetch(`${base}/health`)).status).toBe(503);
    await down.$disconnect();
  });
});

describe("incoming messages (D117, D118)", () => {
  it("rejects a bad signature with 401 and stores nothing", async () => {
    const base = await start();

    expect((await post(base, fixture("text"), "sha256=00")).status).toBe(401);
    expect((await post(base, fixture("text"), null)).status).toBe(401);
    expect(await db.message.count()).toBe(0);
  });

  it("stores a text message and enqueues the turn, then ignores the same delivery", async () => {
    const base = await start();

    expect((await post(base, fixture("text"))).status).toBe(200);
    expect((await post(base, fixture("text"))).status).toBe(200);

    expect(await db.message.findMany()).toMatchObject([
      { providerMessageId: "wamid.TEXT1", body: "ciao", type: "text", status: "received" },
    ]);
    expect(queue.named("process-contact")).toHaveLength(1);
    expect(
      (await db.contact.findFirstOrThrow({ where: { externalId: "393334445566" } })).phoneE164,
    ).toBe("+393334445566");
  });

  it("stores a tap with its id and a voice note as audio", async () => {
    const base = await start();

    await post(base, fixture("interactive-button"));
    await post(base, fixture("audio"));

    const rows = await db.message.findMany({ orderBy: { ordinal: "asc" } });
    expect(rows.map((m) => [m.type, m.body, m.replyId])).toEqual([
      ["interactive", "Accetto", "consent:privacy:accepted"],
      ["audio", null, null],
    ]);
  });

  it("keeps a payload it cannot read as a dead letter and still answers 200", async () => {
    const base = await start();

    expect((await post(base, "{ not json")).status).toBe(200);
    expect((await post(base, JSON.stringify({ object: "page", entry: [] }))).status).toBe(200);

    expect(
      (await db.inboundDeadLetter.findMany({ orderBy: { createdAt: "asc" } })).map((d) => d.reason),
    ).toEqual(["invalid_json", "not_whatsapp"]);
  });

  it("keeps a message for a number that is not ours as a dead letter", async () => {
    const base = await start();
    const foreign = fixture("text").replace("123456789012345", "555555555555555");

    expect((await post(base, foreign)).status).toBe(200);

    expect(await db.message.count()).toBe(0);
    expect((await db.inboundDeadLetter.findFirstOrThrow()).reason).toBe("unknown_sender");
  });

  it("keeps an item it cannot read and still stores the others", async () => {
    const base = await start();
    const payload = JSON.parse(fixture("multi")) as {
      entry: { changes: { value: { messages?: unknown[] } }[] }[];
    };
    payload.entry[0]?.changes[0]?.value.messages?.push({ id: "wamid.BAD", type: "text" });

    await post(base, JSON.stringify(payload));

    expect(await db.message.count()).toBe(2);
    expect((await db.inboundDeadLetter.findFirstOrThrow()).reason).toBe("unreadable_item");
  });

  it("answers 413 to a body that is too large", async () => {
    const base = await start();

    expect((await post(base, "x".repeat(1_100_000))).status).toBe(413);
  });

  it("answers 500 when the database is down, so that Meta tries again", async () => {
    const down = createDatabase(testDatabaseUrl().replace(/:\d+\//, ":1/"));
    const base = await start({ db: down });

    expect((await post(base, fixture("text"))).status).toBe(500);
    await down.$disconnect();
  });
});

describe("delivery statuses (D120)", () => {
  async function sentMessage(providerMessageId: string) {
    const sessionId = (await startSession(scenario)).id;
    const key = { contactId: scenario.contactId, senderNumberId: scenario.senderId };
    await queueOutbound(db, [
      {
        ...key,
        sessionId,
        turnId: null,
        body: "ciao",
        language: "it",
        stepId: null,
        questionId: null,
      },
    ]);
    const claim = await claimNextOutbound(db, key, new Date(), 60_000);
    if (claim === null || claim === "busy") throw new Error("expected a claim");
    await finishSend(db, claim, { kind: "sent", providerMessageId, at: new Date() });
  }

  it("updates a message that was delivered", async () => {
    const base = await start();
    await sentMessage("wamid.OUT1");

    await post(base, fixture("status-delivered"));

    expect((await db.message.findFirstOrThrow()).status).toBe("delivered");
  });

  it("flags the session when a delivery fails, through a job (C7)", async () => {
    const base = await start();
    await sentMessage("wamid.OUT2");

    expect((await post(base, fixture("status-failed"))).status).toBe(200);

    expect(await db.message.findFirstOrThrow()).toMatchObject({
      status: "failed",
      errorCode: "outside_window",
    });
    // The webhook does not wait for the contact's lock: the worker flags the session.
    expect((await db.session.findFirstOrThrow()).status).toBe("active");
    const jobs = queue.named("report-failure");
    expect(jobs).toHaveLength(1);

    await reportOutboundFailure(
      { db, config: testConfig(), logger: pino({ level: "silent" }), now: () => new Date() },
      jobs[0]?.payload as { contactId: string; sessionId: string; turnId: string | null },
    );

    expect((await db.session.findFirstOrThrow()).status).toBe("needs_attention");
  });
});
