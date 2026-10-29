import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { importCampaign } from "../../src/campaigns/import";
import { naiveInterpreter } from "../../src/cli/simulate/naive-interpreter";
import { createTextResolver, type TextResolver } from "../../src/i18n/resolve";
import { MemoryTranslationCache } from "../../src/i18n/translation-cache";
import type { Interpreter } from "../../src/nlu/interpreter";
import type { NluTraceRecord, NluTraceSink } from "../../src/nlu/trace";
import { processContact } from "../../src/runtime/process-contact";
import type { QueueRuntime } from "../../src/store/queue";
import { minimalCampaign } from "../unit/campaigns/fixtures";
import { createTestDatabase, resetBotSchema } from "./helpers/database";
import { countJobs, peekQueue, startTestQueue } from "./helpers/queue";
import {
  makeHarness,
  replies,
  say,
  seedScenario,
  startSession,
  testResolver,
  type Harness,
} from "./helpers/runtime";

const db = createTestDatabase();
let queueRuntime: QueueRuntime;

beforeAll(async () => {
  queueRuntime = await startTestQueue();
});

afterAll(async () => {
  await queueRuntime.stop();
  await db.$disconnect();
});

beforeEach(async () => {
  await resetBotSchema(db);
  await queueRuntime.purge();
});

async function harness(
  options: Parameters<typeof makeHarness>[1] = {},
  importStandard = true,
): Promise<Harness> {
  return makeHarness(await seedScenario(db, { importStandard }), options);
}

const run = (h: Harness) => processContact(h.deps, h.key);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Welcome, then Italian: the conversation is in the flow, on the first consent. */
async function inFlow(h: Harness): Promise<Harness> {
  await say(h, "ciao");
  await run(h);
  await say(h, "italiano");
  await run(h);
  return h;
}

function trace(turnId: string | null): NluTraceRecord {
  return {
    turnId,
    task: "interpret",
    promptVersion: "interpret-test",
    provider: "fake",
    model: "fake-model",
    attempt: "primary",
    repair: false,
    input: [{ role: "user", content: "redacted" }],
    output: "{}",
    valid: true,
    latencyMs: 1,
    inputTokens: null,
    outputTokens: null,
    costEstimate: null,
    error: null,
    at: new Date().toISOString(),
  };
}

describe("a new conversation", () => {
  it("creates the session on the default campaign and welcomes, once (D104, D105)", async () => {
    const h = await harness();
    await say(h, "ciao");

    expect(await run(h)).toBe("replied");

    const session = await db.session.findFirstOrThrow();
    expect(session).toMatchObject({
      status: "active",
      language: null,
      openKey: `${h.key.contactId}:${h.key.senderNumberId}`,
    });
    expect(session.engineState).toMatchObject({ phase: "language" });
    expect((await replies(db)).map((body) => body.includes("In che lingua"))).toEqual([true]);
    expect(await db.turn.findFirstOrThrow()).toMatchObject({
      outcome: "replied",
      sessionId: session.id,
      contactId: h.key.contactId,
    });
    expect(await db.message.findFirstOrThrow({ where: { direction: "inbound" } })).toMatchObject({
      status: "processed",
      sessionId: session.id,
      bodyRedacted: "ciao",
    });
    expect(h.queue.named("send-messages")).toHaveLength(1);
    expect(h.queue.named("send-messages")[0]?.inTransaction).toBe(true);
    // The first message is not interpreted: it only opened the conversation.
    expect(await db.nluTrace.count()).toBe(0);
  });

  it("replies nothing and records why when no campaign matches (D105)", async () => {
    const h = await harness({}, false);
    await say(h, "ciao");

    expect(await run(h)).toBe("no_campaign");

    expect(await db.session.count()).toBe(0);
    expect(await replies(db)).toEqual([]);
    expect(await db.turn.findFirstOrThrow()).toMatchObject({
      outcome: "no_campaign",
      sessionId: null,
      contactId: h.key.contactId,
    });
    expect((await db.message.findFirstOrThrow()).status).toBe("processed");
  });

  it("uses an exact keyword before the default campaign", async () => {
    const h = await harness();
    const acme = await importCampaign(db, minimalCampaign(), {
      activate: true,
      nodeEnv: "development",
    });
    if (!acme.ok) throw new Error("import failed");
    await say(h, " ACME ");

    await run(h);

    expect((await db.session.findFirstOrThrow()).campaignVersionId).toBe(acme.versionId);
  });

  it("finds a keyword in any message of the burst, not only in the joined text", async () => {
    const h = await harness();
    const acme = await importCampaign(db, minimalCampaign(), {
      activate: true,
      nodeEnv: "development",
    });
    if (!acme.ok) throw new Error("import failed");
    await say(h, "ciao");
    await say(h, " ACME ");

    await run(h);

    expect((await db.session.findFirstOrThrow()).campaignVersionId).toBe(acme.versionId);
  });

  it("answers a message delivered twice only once (dedup, spec §14)", async () => {
    const h = await harness();
    expect(await say(h, "ciao", { providerMessageId: "wamid.twice" })).toEqual({
      duplicate: false,
    });
    expect(await say(h, "ciao", { providerMessageId: "wamid.twice" })).toEqual({
      duplicate: true,
    });

    expect(await run(h)).toBe("replied");
    expect(await run(h)).toBe("no_messages");

    expect(await db.message.count({ where: { direction: "inbound" } })).toBe(1);
    expect(await replies(db)).toHaveLength(1);
    expect(await db.turn.count()).toBe(1);
  });
});

describe("an ongoing conversation", () => {
  it("picks the language, moves on, and saves the candidate's state", async () => {
    const h = await harness();
    await say(h, "ciao");
    await run(h);

    await say(h, "italiano");
    expect(await run(h)).toBe("replied");

    const session = await db.session.findFirstOrThrow();
    expect(session.language).toBe("it");
    expect(session.engineState).toMatchObject({ phase: "flow", language: "it", v: 1 });
    expect(session.engineState).not.toHaveProperty("profile");
    expect((await db.contact.findFirstOrThrow()).preferredLanguage).toBe("it");
    const bodies = await replies(db);
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    expect(bodies.at(-1)).toContain("SEGNAPOSTO");
  });

  it("reads the whole burst as one turn, in order (D106)", async () => {
    const h = await harness();
    await say(h, "ciao");
    await run(h);

    await say(h, "english");
    await say(h, "please");
    expect(await run(h)).toBe("replied");

    expect((await db.session.findFirstOrThrow()).language).toBe("en");
    const turn = await db.turn.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
    const inbound = await db.message.findMany({
      where: { direction: "inbound" },
      orderBy: { ordinal: "asc" },
    });
    expect(turn.inboundMessageIds).toEqual(inbound.slice(1).map((m) => m.id));
    expect(inbound.every((m) => m.status === "processed" && m.turnId !== null)).toBe(true);
  });

  it("records the consent and the threshold, then asks the optional one", async () => {
    const h = await inFlow(await harness());

    await say(h, "sì");
    await run(h);

    const consent = await db.consent.findFirstOrThrow();
    expect(consent).toMatchObject({
      consentKey: "privacy_interview",
      outcome: "accepted",
      language: "it",
      textShownIsCurated: true,
    });
    expect(consent.textShown).toContain("SEGNAPOSTO");
    expect(consent.messageId).not.toBeNull();
    expect(consent.contactHash).not.toBeNull();
    const session = await db.session.findFirstOrThrow();
    expect(session.engineState).toMatchObject({ consentsAccepted: true });
    expect(h.queue.named("kubri-webhook").map((j) => j.payload)).toEqual([
      { sessionId: session.id, event: "consents.accepted" },
    ]);
  });

  it("records the consent text that was shown, not a new resolution at answer time (D111d)", async () => {
    let translatorDown = true;
    const resolver = createTextResolver({
      translator: {
        translate: (request) =>
          translatorDown
            ? Promise.reject(new Error("down"))
            : Promise.resolve({ text: `[en] ${request.text}`, provider: "fake", model: "fake" }),
      },
      cache: new MemoryTranslationCache(),
    });
    const h = await harness({ resolver });
    await say(h, "ciao");
    await run(h);
    await say(h, "english");
    await run(h); // the consent goes out in Italian: the translator is down (D72)
    const shown = (await replies(db)).find((body) => body.includes("Prima di iniziare"));
    translatorDown = false;

    await say(h, "yes");
    await run(h);

    const consent = await db.consent.findFirstOrThrow();
    expect(consent).toMatchObject({
      consentKey: "privacy_interview",
      outcome: "accepted",
      language: "it",
      textShownIsCurated: true,
      linkShown: null,
    });
    expect(consent.textShown).toBe(shown);
  });

  it("ends a declined conversation: stop, purge, goodbye, and a new one can start (D109)", async () => {
    const h = await inFlow(await harness());

    await say(h, "no");
    await run(h);

    const session = await db.session.findFirstOrThrow();
    expect(session).toMatchObject({ status: "stopped", openKey: null });
    expect(session.stoppedAt).not.toBeNull();
    expect((await replies(db)).at(-1)).toContain("l'intervista finisce qui");
    expect(await db.consent.count()).toBe(1);

    await say(h, "ciao di nuovo");
    await run(h);
    expect(await db.session.count()).toBe(2);
  });

  it("saves a purged session without its pending confirmation (D109)", async () => {
    const h = await inFlow(await harness());
    // A value waiting for its yes/no, as a low-confidence answer would leave it. The engine
    // clears it on a stop too; the runtime does not rely on that (savedState, unit tested).
    const session = await db.session.findFirstOrThrow();
    await db.session.update({
      where: { id: session.id },
      data: {
        engineState: {
          ...(session.engineState as Record<string, unknown>),
          pendingConfirmation: {
            kind: "value",
            field: "firstName",
            value: "Mario",
            confidence: 0.4,
          },
        },
      },
    });

    await say(h, "stop");
    await run(h);

    const stopped = await db.session.findFirstOrThrow();
    expect(stopped.status).toBe("stopped");
    expect(stopped.engineState).toMatchObject({ pendingConfirmation: null, phase: "closed" });
    expect(JSON.stringify(stopped.engineState)).not.toContain("Mario");
  });

  it("opts out on a stop keyword and welcomes the contact back when they write again (D105)", async () => {
    const h = await harness();
    await say(h, "ciao");
    await run(h);

    await say(h, "stop");
    await run(h);
    expect((await db.contactChannelState.findFirstOrThrow()).optInStatus).toBe("opted_out");
    expect((await db.session.findFirstOrThrow()).status).toBe("stopped");

    await say(h, "ciao");
    expect((await db.contactChannelState.findFirstOrThrow()).optInStatus).toBe("opted_in");
  });

  it("asks to confirm a deletion and enqueues delete-contact on yes (D109)", async () => {
    const h = await inFlow(await harness());

    await say(h, "cancella i miei dati");
    await run(h);
    expect((await replies(db)).at(-1)).toContain("Rispondi sì per cancellare");
    await say(h, "sì");
    await run(h);

    expect(h.queue.named("delete-contact").map((j) => j.payload)).toEqual([
      { contactId: h.key.contactId },
    ]);
    const session = await db.session.findFirstOrThrow();
    expect(session.status).toBe("stopped");
    expect(session.engineState).toMatchObject({ pendingConfirmation: null });
  });

  it("opens a new session on a keyword when the old one is completed, and only then (D105)", async () => {
    const h = await harness();
    const acme = await importCampaign(db, minimalCampaign(), {
      activate: true,
      nodeEnv: "development",
    });
    if (!acme.ok) throw new Error("import failed");
    const old = await startSession(h.scenario);
    await db.session.update({
      where: { id: old.id },
      data: { status: "completed", engineState: { v: 1, phase: "post_completion" } },
    });

    await say(h, "ciao");
    await run(h);
    expect(await db.session.count()).toBe(1);

    await say(h, "acme");
    await run(h);

    const sessions = await db.session.findMany({ orderBy: { startedAt: "asc" } });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ status: "completed", openKey: null });
    expect(sessions[1]?.campaignVersionId).toBe(acme.versionId);
  });

  it("keeps an interview still running when the candidate writes a keyword (D105)", async () => {
    const h = await inFlow(await harness());
    const acme = await importCampaign(db, minimalCampaign(), {
      activate: true,
      nodeEnv: "development",
    });
    if (!acme.ok) throw new Error("import failed");

    // Only a message without an open session (or after completion) is routed by keyword.
    await say(h, "acme");
    await run(h);
    expect(await db.session.count()).toBe(1);
  });
});

describe("waiting, locking and rolling back", () => {
  it("does nothing when there is nothing to process", async () => {
    const h = await harness();

    expect(await run(h)).toBe("no_messages");
    expect(await db.turn.count()).toBe(0);
  });

  it("waits for a quiet moment and reschedules itself (D106)", async () => {
    const h = await harness({ config: { DEBOUNCE_MS: "300", DEBOUNCE_MAX_WAIT_MS: "5000" } });
    await say(h, "ciao");

    expect(await run(h)).toBe("rescheduled");
    expect(await db.session.count()).toBe(0);
    expect((await db.message.findFirstOrThrow()).status).toBe("received");
    expect(h.queue.named("process-contact").at(-1)?.options.startAfterSeconds).toBe(1);

    await sleep(350);
    expect(await run(h)).toBe("replied");
  });

  it("lets only one of two concurrent workers process the contact (D102)", async () => {
    const h = await harness();
    await say(h, "ciao");

    const results = await Promise.all([run(h), run(h)]);

    expect([...results].sort()).toEqual(["no_messages", "replied"]);
    expect(await db.turn.count()).toBe(1);
    expect(await db.session.count()).toBe(1);
    expect(await replies(db)).toHaveLength(1);
  });

  it("holds the second turn until the first commits, then runs it on the new state (D102)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const slow: Interpreter = {
      async interpret(request) {
        calls += 1;
        if (calls === 1) await gate;
        return naiveInterpreter.interpret(request);
      },
    };
    const h = await harness({ interpreter: slow });
    await say(h, "ciao");
    await run(h);
    await say(h, "italiano");

    const first = run(h);
    await sleep(200);
    await say(h, "sì");
    const second = run(h);
    await sleep(200);
    // The second worker waits on the contact's lock: nothing of the second message moved.
    expect(
      (
        await db.message.findMany({ where: { direction: "inbound" }, orderBy: { ordinal: "asc" } })
      ).map((m) => m.status),
    ).toEqual(["processed", "received", "received"]);
    release();

    expect(await first).toBe("replied");
    expect(await second).toBe("replied");
    // The second turn ran after the first: it answered the consent the first one asked.
    expect(await db.consent.count()).toBe(1);
    const turns = await db.turn.findMany({ orderBy: { startedAt: "asc" } });
    expect(turns.map((t) => t.inboundMessageIds.length)).toEqual([1, 1, 1]);
  });

  it("rolls everything back when a step fails: no session, no reply, no job (D102, D103)", async () => {
    const failing: TextResolver = {
      ...testResolver(),
      resolveSend: () => Promise.reject(new Error("translator exploded")),
      // The turn asks for its budgeted copy: it must still be this one.
      withDeadline: () => failing,
    };
    const h = await harness({ queue: queueRuntime.queue, resolver: failing });
    await say(h, "ciao");
    await queueRuntime.purge();

    await expect(run(h)).rejects.toThrow("translator exploded");

    expect(await db.session.count()).toBe(0);
    expect(await db.turn.count()).toBe(0);
    expect(await db.sessionFlag.count()).toBe(0);
    expect(await replies(db)).toEqual([]);
    expect((await db.message.findFirstOrThrow()).status).toBe("received");
    expect(await peekQueue(db, "send-messages")).toEqual([]);
  });

  it("reprocesses the messages of a rolled-back turn when the job is redelivered", async () => {
    let failures = 1;
    const base = testResolver();
    const flaky: TextResolver = {
      ...base,
      resolveSend: (...args: Parameters<typeof base.resolveSend>) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error("translator exploded"));
        }
        return base.resolveSend(...args);
      },
      withDeadline: () => flaky,
    };
    const h = await harness({ queue: queueRuntime.queue, resolver: flaky });
    await say(h, "ciao");

    await expect(run(h)).rejects.toThrow("translator exploded");
    expect(await run(h)).toBe("replied");

    expect(await db.session.count()).toBe(1);
    expect(await replies(db)).toHaveLength(1);
    expect((await db.message.findFirstOrThrow({ where: { direction: "inbound" } })).status).toBe(
      "processed",
    );
    expect((await peekQueue(db, "send-messages")).map((j) => j.data)).toEqual([h.key]);
  });
});

describe("through the real queue (retries and dead letters, spec §14)", () => {
  async function withWorker<T>(h: Harness, body: (queue: QueueRuntime) => Promise<T>): Promise<T> {
    const queue = await startTestQueue();
    try {
      await queue.work(
        "process-contact",
        async (payload) => {
          await processContact(h.deps, payload);
        },
        { batchSize: 1, pollingIntervalSeconds: 0.5 },
      );
      return await body(queue);
    } finally {
      await queue.stop();
    }
  }

  it("retries a failed turn and answers on the second delivery", async () => {
    let failures = 1;
    const base = testResolver();
    const flaky: TextResolver = {
      ...base,
      resolveSend: (...args: Parameters<typeof base.resolveSend>) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error("translator exploded"));
        }
        return base.resolveSend(...args);
      },
      withDeadline: () => flaky,
    };
    const h = await harness({ queue: queueRuntime.queue, resolver: flaky });

    await withWorker(h, async () => {
      await say(h, "ciao");
      await expect.poll(() => db.turn.count(), { timeout: 20_000, interval: 300 }).toBe(1);
    });

    expect(failures).toBe(0);
    expect(await replies(db)).toHaveLength(1);
    expect(await countJobs(db, "process-contact-dead")).toBe(0);
  });

  it("sends a turn that keeps failing to the dead letters, its messages still received", async () => {
    const failing: TextResolver = {
      ...testResolver(),
      resolveSend: () => Promise.reject(new Error("translator exploded")),
      // The turn asks for its budgeted copy: it must still be this one.
      withDeadline: () => failing,
    };
    const h = await harness({ queue: queueRuntime.queue, resolver: failing });

    await withWorker(h, async () => {
      await say(h, "ciao");
      await expect
        .poll(() => countJobs(db, "process-contact-dead"), { timeout: 25_000, interval: 300 })
        .toBe(1);
    });

    expect(await db.turn.count()).toBe(0);
    expect((await db.message.findFirstOrThrow()).status).toBe("received");
  });
});

describe("when something goes wrong: never silent (D107)", () => {
  async function inFlowWith(interpreter: Interpreter): Promise<Harness> {
    return inFlow(await harness({ interpreter, config: { TURN_NLU_DEADLINE_MS: "100" } }));
  }

  it("answers when the NLU is too slow", async () => {
    const h = await inFlowWith({ interpret: () => new Promise(() => undefined) });
    await say(h, "boh");

    expect(await run(h)).toBe("replied");

    expect((await replies(db)).some((body) => body.includes("non ho capito"))).toBe(true);
  });

  it("answers when the NLU throws", async () => {
    const h = await inFlowWith({ interpret: () => Promise.reject(new Error("boom")) });
    await say(h, "boh");

    expect(await run(h)).toBe("replied");

    expect((await replies(db)).some((body) => body.includes("non ho capito"))).toBe(true);
  });

  it("answers when the NLU throws synchronously", async () => {
    const h = await inFlowWith({
      interpret: () => {
        throw new Error("boom");
      },
    });
    await say(h, "boh");

    expect(await run(h)).toBe("replied");
  });

  it("answers in Italian when the translator hangs, within the turn's budget (D72, D102)", async () => {
    const hanging = createTextResolver({
      translator: { translate: () => new Promise(() => undefined) },
      cache: new MemoryTranslationCache(),
    });
    const h = await harness({ resolver: hanging, config: { TURN_NLU_DEADLINE_MS: "300" } });
    await say(h, "ciao");
    await run(h);
    await say(h, "english");
    const started = Date.now();

    expect(await run(h)).toBe("replied");

    // One 300 ms budget for every text of the turn, far below the transaction's 30.6 s.
    expect(Date.now() - started).toBeLessThan(3000);
    const turn = await db.turn.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
    const sent = await db.message.findMany({ where: { direction: "outbound", turnId: turn.id } });
    expect(sent.length).toBeGreaterThan(0);
    // The campaign has no curated English: every text fell back to Italian.
    expect(sent.every((m) => m.language === "it")).toBe(true);
    expect((await db.session.findFirstOrThrow()).language).toBe("en");
  });

  it("still obeys the global keywords with no NLU at all", async () => {
    const h = await inFlowWith({ interpret: () => Promise.resolve(null) });
    await say(h, "stop");

    await run(h);

    expect((await db.session.findFirstOrThrow()).status).toBe("stopped");
  });

  it("answers with the generic error and flags a stored state it cannot read", async () => {
    const h = await harness();
    await say(h, "ciao");
    await run(h);
    await db.session.updateMany({ data: { engineState: { phase: "dancing" } } });
    await say(h, "italiano");

    expect(await run(h)).toBe("failed");

    const session = await db.session.findFirstOrThrow();
    expect(session.status).toBe("needs_attention");
    expect(session.openKey).not.toBeNull();
    expect(session.engineState).toEqual({ phase: "dancing" });
    expect((await replies(db)).at(-1)).toContain("problema da parte mia");
    expect(await db.sessionFlag.findFirstOrThrow()).toMatchObject({
      reason: "incoherent_state",
      needsAttention: true,
    });
    expect(await db.turn.findFirstOrThrow({ where: { outcome: "failed" } })).toBeDefined();
    expect(h.queue.named("send-messages")).toHaveLength(2);
  });

  it("lets a database error through instead of calling the state unreadable", async () => {
    const h = await harness();
    await say(h, "ciao");
    await run(h);
    // Not a decoding problem: the read fails (P2025), and the job must retry, not flag.
    await db.candidateProfile.deleteMany();
    await say(h, "italiano");

    await expect(run(h)).rejects.toThrow();

    expect(await db.sessionFlag.count()).toBe(0);
    expect((await db.session.findFirstOrThrow()).status).toBe("active");
    expect(await replies(db)).toHaveLength(1);
    expect((await db.message.findFirstOrThrow({ where: { body: "italiano" } })).status).toBe(
      "received",
    );
  });

  it("flags the parts of the stored state it had to drop, and goes on", async () => {
    const h = await inFlow(await harness());
    const session = await db.session.findFirstOrThrow();
    await db.session.update({
      where: { id: session.id },
      data: {
        engineState: {
          ...(session.engineState as Record<string, unknown>),
          pendingConfirmation: { kind: "teleport" },
        },
      },
    });
    await say(h, "sì");

    expect(await run(h)).toBe("replied");

    expect(await db.sessionFlag.findFirstOrThrow()).toMatchObject({
      reason: "state_part_dropped",
      field: "pendingConfirmation",
      needsAttention: false,
    });
    expect((await db.session.findFirstOrThrow()).status).toBe("active");
  });
});

describe("the NLU traces of a turn (D110)", () => {
  function tracing(delayMs: number): (sink: NluTraceSink) => Interpreter {
    return (sink) => ({
      async interpret(request) {
        await sleep(delayMs);
        await sink.write(trace(request.turnId));
        return naiveInterpreter.interpret(request);
      },
    });
  }

  it("writes them in the turn's transaction, pointing at the turn", async () => {
    const h = await inFlow(await harness({ interpreterFor: tracing(0) }));

    const turns = await db.turn.findMany({ orderBy: { startedAt: "asc" } });
    const traces = await db.nluTrace.findMany();
    expect(traces.map((t) => t.turnId)).toEqual([turns[1]?.id]);
    expect(h.queue.jobs.length).toBeGreaterThan(0);
  });

  it("drops a trace that arrives after the NLU deadline", async () => {
    const h = await harness({
      interpreterFor: tracing(400),
      config: { TURN_NLU_DEADLINE_MS: "100" },
    });
    await say(h, "ciao");
    await run(h);
    await say(h, "italiano");

    expect(await run(h)).toBe("replied");
    await sleep(500);

    expect(await db.nluTrace.count()).toBe(0);
  });
});

describe("messages that are not text (D107)", () => {
  it("does not run the engine for media only, and records the turn", async () => {
    const h = await harness();
    await say(h, "ciao");
    await run(h);
    await say(h, null, { type: "audio" });

    expect(await run(h)).toBe("ignored_media");

    const turn = await db.turn.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
    expect(turn.outcome).toBe("ignored_media");
    expect(turn.sessionId).toBe((await db.session.findFirstOrThrow()).id);
    expect(await replies(db)).toHaveLength(1);
  });
});

describe("the history for the NLU (D107)", () => {
  it("keeps a redacted copy of each message, never the original", async () => {
    const h = await harness();
    await say(h, "ciao");
    await run(h);

    await say(h, "scrivetemi a mario.rossi@example.com");
    await run(h);

    const copies = (
      await db.message.findMany({ where: { direction: "inbound" }, orderBy: { ordinal: "asc" } })
    ).map((m) => m.bodyRedacted);
    expect(copies).toEqual(["ciao", "scrivetemi a [email]"]);
  });

  it("sends the interpreter only the redacted history, without the current message", async () => {
    const seen: (readonly string[])[] = [];
    const spy: Interpreter = {
      interpret(request) {
        seen.push(request.history);
        return naiveInterpreter.interpret(request);
      },
    };
    const h = await harness({ interpreter: spy });
    await say(h, "ciao");
    await run(h);
    await say(h, "scrivetemi a mario.rossi@example.com");
    await run(h);
    await say(h, "italiano");
    await run(h);

    expect(seen).toEqual([["ciao"], ["ciao", "scrivetemi a [email]"]]);
  });
});
