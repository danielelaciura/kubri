import { pino } from "pino";
import { importCampaign } from "../../../src/campaigns/import";
import { FakeChannel } from "../../../src/channels/channel";
import { naiveInterpreter } from "../../../src/cli/simulate/naive-interpreter";
import type { LoadedCampaign } from "../../../src/campaigns/loaded-campaign";
import { initialSessionState } from "../../../src/engine/state";
import { FakeTranslator } from "../../../src/i18n/fake-translator";
import { createTextResolver, type TextResolver } from "../../../src/i18n/resolve";
import { MemoryTranslationCache } from "../../../src/i18n/translation-cache";
import type { Interpreter } from "../../../src/nlu/interpreter";
import {
  parseRuntimeConfig,
  requireConsentHashSecret,
  type RuntimeConfig,
} from "../../../src/runtime/config";
import { MemoryJobQueue } from "../../../src/runtime/memory-queue";
import type { RuntimeDeps } from "../../../src/runtime/process-contact";
import { receiveInbound } from "../../../src/runtime/receive";
import type { SendDeps } from "../../../src/runtime/send-messages";
import { encodeState } from "../../../src/runtime/state-codec";
import { findCampaignVersion } from "../../../src/store/campaigns";
import { upsertContact } from "../../../src/store/contacts";
import type { Database } from "../../../src/store/db";
import type { JobQueue } from "../../../src/store/queue";
import { createSession, type SessionRecord } from "../../../src/store/sessions";
import { loadStandardCampaign, seedRegistry } from "./registry";

export const silentLogger = pino({ level: "silent" });

/** From .env.test (a dummy value), as the worker reads it at start-up. */
export const TEST_CONSENT_SECRET = requireConsentHashSecret(parseRuntimeConfig(process.env));

export interface Scenario {
  readonly db: Database;
  readonly senderId: string;
  readonly contactId: string;
  readonly externalId: string;
  readonly phone: string;
  /** The standard Kubri campaign, active and default on the sender; null if not imported. */
  readonly campaign: LoadedCampaign | null;
}

export interface ScenarioOptions {
  /** Import and activate the standard campaign (default true). */
  readonly importStandard?: boolean;
}

/** An empty database with the registry, the standard campaign and one known contact. */
export async function seedScenario(db: Database, options: ScenarioOptions = {}): Promise<Scenario> {
  const { sender } = await seedRegistry(db);
  let campaign: LoadedCampaign | null = null;
  if (options.importStandard ?? true) {
    const imported = await importCampaign(db, loadStandardCampaign(), {
      activate: true,
      nodeEnv: "development",
    });
    if (!imported.ok) throw new Error("import failed");
    campaign = await findCampaignVersion(db, imported.versionId);
  }
  const phone = "+393331112233";
  const externalId = "393331112233";
  const contact = await upsertContact(db, { channel: "whatsapp", externalId, phoneE164: phone });
  return { db, senderId: sender.id, contactId: contact.id, externalId, phone, campaign };
}

/** A session on the scenario's campaign, in the initial engine state. */
export async function startSession(scenario: Scenario): Promise<SessionRecord> {
  if (!scenario.campaign) throw new Error("the scenario has no campaign");
  return createSession(scenario.db, {
    contactId: scenario.contactId,
    senderNumberId: scenario.senderId,
    campaignVersionId: scenario.campaign.versionId,
    state: encodeState(initialSessionState()),
    at: new Date(),
  });
}

export function testResolver(): TextResolver {
  return createTextResolver({
    translator: new FakeTranslator(),
    cache: new MemoryTranslationCache(),
  });
}

export function testConfig(overrides: Record<string, string> = {}): RuntimeConfig {
  return parseRuntimeConfig({
    DEBOUNCE_MS: "0",
    TURN_NLU_DEADLINE_MS: "2000",
    SEND_MAX_ATTEMPTS: "3",
    ...overrides,
  });
}

export interface Harness {
  readonly scenario: Scenario;
  readonly deps: RuntimeDeps;
  readonly sendDeps: SendDeps;
  readonly queue: MemoryJobQueue;
  readonly channel: FakeChannel;
  readonly key: { readonly contactId: string; readonly senderNumberId: string };
}

export interface HarnessOptions {
  readonly interpreter?: Interpreter;
  /** Built with the turn's trace sink, for tests that look at the traces. */
  readonly interpreterFor?: RuntimeDeps["interpreterFor"];
  readonly config?: Record<string, string>;
  /** A real queue (pg-boss) instead of the in-memory one. */
  readonly queue?: JobQueue;
  readonly resolver?: RuntimeDeps["resolver"];
}

/** Everything a runtime test needs, wired with fakes: no LLM, no Meta (CLAUDE.md). */
export function makeHarness(scenario: Scenario, options: HarnessOptions = {}): Harness {
  const queue = new MemoryJobQueue();
  const channel = new FakeChannel();
  const config = testConfig(options.config);
  const interpreter = options.interpreter ?? naiveInterpreter;
  const jobQueue = options.queue ?? queue;
  const deps: RuntimeDeps = {
    db: scenario.db,
    config,
    logger: silentLogger,
    queue: jobQueue,
    resolver: options.resolver ?? testResolver(),
    interpreterFor: options.interpreterFor ?? (() => interpreter),
    historyMessages: 3,
    consentHashSecret: TEST_CONSENT_SECRET,
    now: () => new Date(),
  };
  const sendDeps: SendDeps = {
    db: scenario.db,
    config,
    logger: silentLogger,
    queue: jobQueue,
    channelFor: () => channel,
    now: () => new Date(),
  };
  return {
    scenario,
    deps,
    sendDeps,
    queue,
    channel,
    key: { contactId: scenario.contactId, senderNumberId: scenario.senderId },
  };
}

let counter = 0;

/**
 * A message from the scenario's contact, through the real ingress. `providerMessageId` lets a
 * test deliver the same message twice, as Meta does.
 */
export async function say(
  harness: Harness,
  body: string | null,
  options: { readonly type?: "text" | "audio"; readonly providerMessageId?: string } = {},
): Promise<{ duplicate: boolean }> {
  counter += 1;
  return receiveInbound(
    { db: harness.scenario.db, queue: harness.deps.queue, config: harness.deps.config },
    {
      senderNumberId: harness.scenario.senderId,
      providerMessageId: options.providerMessageId ?? `wamid.test.${counter}`,
      from: { externalId: harness.scenario.externalId, phoneE164: harness.scenario.phone },
      type: options.type ?? "text",
      body,
      receivedAt: new Date(),
      payloadRaw: { n: counter },
    },
  );
}

/** The bodies of the replies, in the order they were queued. */
export async function replies(db: Database): Promise<string[]> {
  const rows = await db.message.findMany({
    where: { direction: "outbound" },
    orderBy: { ordinal: "asc" },
  });
  return rows.map((row) => row.body ?? "");
}
