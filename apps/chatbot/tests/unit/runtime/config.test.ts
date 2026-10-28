import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "../../../src/runtime/config";

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
    });
  });

  it("treats an empty variable as unset and explains invalid ones without echoing them", () => {
    expect(parseRuntimeConfig({ DEBOUNCE_MS: "" }).debounceMs).toBe(3000);
    expect(() => parseRuntimeConfig({ DEBOUNCE_MS: "soon" })).toThrow(/DEBOUNCE_MS/);
    expect(() => parseRuntimeConfig({ DEBOUNCE_MS: "soon" })).not.toThrow(/soon/);
    expect(() => parseRuntimeConfig({ QUEUE_SCHEMA: "bot; DROP" })).toThrow(/QUEUE_SCHEMA/);
  });
});
