import { describe, expect, it } from "vitest";
import {
  parseRuntimeConfig,
  requireConsentHashSecret,
  requireQueueDatabaseUrl,
} from "../../../src/runtime/config";

const SECRET = "test-consent-hash-secret-0123456789abcdef";
const QUEUE_URL = "postgresql://u:p@db.example.com:5432/postgres";
const APP_URL = "postgresql://u:p@localhost:54329/kubri_bot_dev?schema=bot";

describe("parseRuntimeConfig", () => {
  it("has defaults and ignores other variables", () => {
    expect(parseRuntimeConfig({ DATABASE_URL: "x", PATH: "/bin" })).toEqual({
      debounceMs: 3000,
      debounceMaxWaitMs: 10_000,
      nluDeadlineMs: 20_000,
      turnTransactionMs: 70_000,
      sendLeaseMs: 60_000,
      sendCallTimeoutMs: 30_000,
      sendMaxAttempts: 5,
      workerBatchSize: 4,
      queueSchema: "bot_queue",
      consentHashSecret: undefined,
      // NODE_ENV unset counts as production: no fallback to DATABASE_URL.
      queueDatabaseUrl: undefined,
    });
  });

  it("reads every variable and derives the transaction and channel call timeouts", () => {
    const config = parseRuntimeConfig({
      DEBOUNCE_MS: "0",
      DEBOUNCE_MAX_WAIT_MS: "500",
      TURN_NLU_DEADLINE_MS: "1000",
      SEND_LEASE_MS: "2000",
      SEND_MAX_ATTEMPTS: "3",
      WORKER_BATCH_SIZE: "1",
      QUEUE_SCHEMA: "bot_queue_test",
      CONSENT_HASH_SECRET: SECRET,
      QUEUE_DATABASE_URL: QUEUE_URL,
    });

    expect(config).toEqual({
      debounceMs: 0,
      debounceMaxWaitMs: 500,
      nluDeadlineMs: 1000,
      turnTransactionMs: 32_000,
      sendLeaseMs: 2000,
      sendCallTimeoutMs: 1000,
      sendMaxAttempts: 3,
      workerBatchSize: 1,
      queueSchema: "bot_queue_test",
      consentHashSecret: SECRET,
      queueDatabaseUrl: QUEUE_URL,
    });
  });

  it("treats an empty variable as unset and explains invalid ones without echoing them", () => {
    expect(parseRuntimeConfig({ DEBOUNCE_MS: "" }).debounceMs).toBe(3000);
    expect(() => parseRuntimeConfig({ DEBOUNCE_MS: "soon" })).toThrow(/DEBOUNCE_MS/);
    expect(() => parseRuntimeConfig({ DEBOUNCE_MS: "soon" })).not.toThrow(/soon/);
    expect(() => parseRuntimeConfig({ QUEUE_SCHEMA: "bot; DROP" })).toThrow(/QUEUE_SCHEMA/);
  });

  it("refuses a short consent hash secret without echoing it", () => {
    expect(() => parseRuntimeConfig({ CONSENT_HASH_SECRET: "short-secret" })).toThrow(
      /CONSENT_HASH_SECRET/,
    );
    expect(() => parseRuntimeConfig({ CONSENT_HASH_SECRET: "short-secret" })).not.toThrow(
      /short-secret/,
    );
  });
});

describe("requireConsentHashSecret", () => {
  it("returns the secret when it is set", () => {
    expect(requireConsentHashSecret(parseRuntimeConfig({ CONSENT_HASH_SECRET: SECRET }))).toBe(
      SECRET,
    );
  });

  it("stops the runtime that writes consents when it is missing", () => {
    expect(() => requireConsentHashSecret(parseRuntimeConfig({}))).toThrow(
      /CONSENT_HASH_SECRET is not set/,
    );
  });
});

describe("queue connection (QUEUE_DATABASE_URL)", () => {
  it("prefers QUEUE_DATABASE_URL in every environment", () => {
    const config = parseRuntimeConfig({
      NODE_ENV: "production",
      DATABASE_URL: APP_URL,
      QUEUE_DATABASE_URL: QUEUE_URL,
    });

    expect(requireQueueDatabaseUrl(config)).toBe(QUEUE_URL);
  });

  it.each(["development", "test"])("falls back to DATABASE_URL in %s", (nodeEnv) => {
    const config = parseRuntimeConfig({ NODE_ENV: nodeEnv, DATABASE_URL: APP_URL });

    expect(config.queueDatabaseUrl).toBe(APP_URL);
  });

  it.each([["production"], [undefined]])("has no fallback with NODE_ENV %s", (nodeEnv) => {
    const config = parseRuntimeConfig({ NODE_ENV: nodeEnv, DATABASE_URL: APP_URL });

    expect(config.queueDatabaseUrl).toBeUndefined();
    expect(() => requireQueueDatabaseUrl(config)).toThrow(/QUEUE_DATABASE_URL is not set/);
  });

  it("refuses a value that is not a postgres URL without echoing it", () => {
    expect(() => parseRuntimeConfig({ QUEUE_DATABASE_URL: "mysql://secret@x/db" })).toThrow(
      /QUEUE_DATABASE_URL/,
    );
    expect(() => parseRuntimeConfig({ QUEUE_DATABASE_URL: "mysql://secret@x/db" })).not.toThrow(
      /secret/,
    );
  });
});
