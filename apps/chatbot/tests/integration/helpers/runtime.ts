import { pino } from "pino";
import { importCampaign } from "../../../src/campaigns/import";
import type { LoadedCampaign } from "../../../src/campaigns/loaded-campaign";
import { initialSessionState } from "../../../src/engine/state";
import { FakeTranslator } from "../../../src/i18n/fake-translator";
import { createTextResolver, type TextResolver } from "../../../src/i18n/resolve";
import { MemoryTranslationCache } from "../../../src/i18n/translation-cache";
import {
  parseRuntimeConfig,
  requireConsentHashSecret,
  type RuntimeConfig,
} from "../../../src/runtime/config";
import { encodeState } from "../../../src/runtime/state-codec";
import { findCampaignVersion } from "../../../src/store/campaigns";
import { upsertContact } from "../../../src/store/contacts";
import type { Database } from "../../../src/store/db";
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
