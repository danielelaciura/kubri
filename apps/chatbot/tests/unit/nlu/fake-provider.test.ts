import { describe, expect, it } from "vitest";
import { FakeLlmProvider } from "../../../src/nlu/fake-provider";
import { LlmError, type LlmRequest } from "../../../src/nlu/llm-provider";

const REQUEST: LlmRequest = {
  messages: [{ role: "user", content: "ciao" }],
  model: "m",
  temperature: 0,
  responseFormat: "json",
  maxTokens: 100,
  timeoutMs: 1000,
};

describe("LlmError", () => {
  it.each([
    ["timeout", true],
    ["network", true],
    ["rate_limited", true],
    ["server", true],
    ["invalid_response", true],
    ["client", false],
  ] as const)("%s is retryable: %s", (kind, retryable) => {
    expect(new LlmError(kind, "x").retryable).toBe(retryable);
  });
});

describe("FakeLlmProvider", () => {
  it("replies in order, records the requests, and runs out loudly", async () => {
    const provider = new FakeLlmProvider([
      "first",
      new LlmError("server", "down"),
      (request) => `echo ${request.model}`,
    ]);

    await expect(provider.complete(REQUEST)).resolves.toEqual({
      content: "first",
      model: "m",
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    await expect(provider.complete(REQUEST)).rejects.toThrow("down");
    await expect(provider.complete(REQUEST)).resolves.toMatchObject({ content: "echo m" });
    await expect(provider.complete(REQUEST)).rejects.toThrow(/no reply queued/);
    expect(provider.requests).toHaveLength(4);
  });
});
