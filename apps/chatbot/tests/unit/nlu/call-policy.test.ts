import { describe, expect, it } from "vitest";
import { callWithPolicy, type CallTiming } from "../../../src/nlu/call-policy";
import { FakeLlmProvider } from "../../../src/nlu/fake-provider";
import { LlmError, type LlmRequest } from "../../../src/nlu/llm-provider";

const REQUEST: LlmRequest = {
  messages: [{ role: "user", content: "x" }],
  model: "primary",
  temperature: 0,
  responseFormat: "json",
  maxTokens: 100,
  timeoutMs: 1000,
};

function timing(): CallTiming & { slept: number[] } {
  const slept: number[] = [];
  let now = 0;
  return {
    slept,
    retryDelaysMs: [500, 1500],
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    clock: () => (now += 10),
  };
}

const down = () => new LlmError("server", "Mistral HTTP 503", 503);

describe("callWithPolicy", () => {
  it("returns the first answer without waiting", async () => {
    const t = timing();

    const result = await callWithPolicy(new FakeLlmProvider(["ok"]), REQUEST, "backup", t);

    expect(result.response?.content).toBe("ok");
    expect(result.attempts).toMatchObject([{ kind: "primary", model: "primary", latencyMs: 10 }]);
    expect(t.slept).toEqual([]);
  });

  it("retries twice with growing waits (spec §8.4)", async () => {
    const t = timing();
    const provider = new FakeLlmProvider([down(), down(), "ok"]);

    const result = await callWithPolicy(provider, REQUEST, "backup", t);

    expect(result.response?.content).toBe("ok");
    expect(result.attempts.map((a) => a.kind)).toEqual(["primary", "retry", "retry"]);
    expect(t.slept).toEqual([500, 1500]);
  });

  it("then tries the fallback model once", async () => {
    const provider = new FakeLlmProvider([down(), down(), down(), "ok"]);

    const result = await callWithPolicy(provider, REQUEST, "backup", timing());

    expect(result.response?.content).toBe("ok");
    expect(result.attempts.map((a) => [a.kind, a.model])).toEqual([
      ["primary", "primary"],
      ["retry", "primary"],
      ["retry", "primary"],
      ["fallback", "backup"],
    ]);
    expect(provider.requests.at(-1)?.model).toBe("backup");
  });

  it("gives up with no response when everything fails", async () => {
    const result = await callWithPolicy(
      new FakeLlmProvider([down(), down(), down(), down()]),
      REQUEST,
      "backup",
      timing(),
    );

    expect(result.response).toBeNull();
    expect(result.attempts).toHaveLength(4);
    expect(result.attempts.every((a) => a.error?.kind === "server")).toBe(true);
  });

  it("stops at once on a client error, without the fallback", async () => {
    const t = timing();
    const provider = new FakeLlmProvider([new LlmError("client", "Mistral HTTP 401", 401)]);

    const result = await callWithPolicy(provider, REQUEST, "backup", t);

    expect(result.response).toBeNull();
    expect(result.attempts).toHaveLength(1);
    expect(t.slept).toEqual([]);
  });

  it("treats an unexpected exception as a retryable server error", async () => {
    const provider = {
      name: "broken",
      complete: () => Promise.reject(new Error("bug: mi chiamo Mariangela")),
    };

    const result = await callWithPolicy(provider, REQUEST, "backup", timing());

    expect(result.attempts).toHaveLength(4);
    expect(result.attempts[0]?.error?.kind).toBe("server");
    expect(result.attempts[0]?.error?.message).not.toContain("Mariangela");
  });
});
