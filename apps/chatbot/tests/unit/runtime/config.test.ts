import { describe, expect, it } from "vitest";
import { parseRuntimeConfig, requireConsentHashSecret } from "../../../src/runtime/config";

const SECRET = "test-consent-hash-secret-0123456789abcdef";

describe("parseRuntimeConfig", () => {
  it("has defaults and ignores other variables", () => {
    expect(parseRuntimeConfig({ DATABASE_URL: "x", PATH: "/bin" })).toEqual({
      debounceMs: 3000,
      debounceMaxWaitMs: 10_000,
      nluDeadlineMs: 20_000,
      turnTransactionMs: 70_000,
      sendLeaseMs: 60_000,
      sendMaxAttempts: 5,
      workerBatchSize: 4,
      queueSchema: "bot_queue",
      consentHashSecret: undefined,
    });
  });

  it("reads every variable and derives the transaction timeout", () => {
    const config = parseRuntimeConfig({
      DEBOUNCE_MS: "0",
      DEBOUNCE_MAX_WAIT_MS: "500",
      TURN_NLU_DEADLINE_MS: "1000",
      SEND_LEASE_MS: "2000",
      SEND_MAX_ATTEMPTS: "3",
      WORKER_BATCH_SIZE: "1",
      QUEUE_SCHEMA: "bot_queue_test",
      CONSENT_HASH_SECRET: SECRET,
    });

    expect(config).toEqual({
      debounceMs: 0,
      debounceMaxWaitMs: 500,
      nluDeadlineMs: 1000,
      turnTransactionMs: 32_000,
      sendLeaseMs: 2000,
      sendMaxAttempts: 3,
      workerBatchSize: 1,
      queueSchema: "bot_queue_test",
      consentHashSecret: SECRET,
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
