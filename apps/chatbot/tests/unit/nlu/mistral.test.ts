import { describe, expect, it } from "vitest";
import { LlmError, type LlmRequest } from "../../../src/nlu/llm-provider";
import { createMistralProvider, MISTRAL_CHAT_URL, type FetchLike } from "../../../src/nlu/mistral";

const REQUEST: LlmRequest = {
  messages: [
    { role: "system", content: "rules" },
    { role: "user", content: "mi chiamo Mariangela" },
  ],
  model: "mistral-small-latest",
  temperature: 0,
  responseFormat: "json",
  maxTokens: 500,
  timeoutMs: 2000,
};

const OK_BODY = {
  id: "x",
  model: "mistral-small-2506",
  choices: [
    { index: 0, message: { role: "assistant", content: '{"a":1}' }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 321, completion_tokens: 12, total_tokens: 333 },
};

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(respond: () => Response | Promise<Response>): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(respond());
    },
  };
}

function sentBody(call: Call | undefined): unknown {
  const raw = call?.init.body;
  if (typeof raw !== "string") throw new Error("expected a string body");
  return JSON.parse(raw);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LlmError) return error;
    throw error;
  }
  throw new Error("expected an LlmError");
}

describe("createMistralProvider", () => {
  it("posts the chat request in JSON mode with the bearer key", async () => {
    const { fetch, calls } = fakeFetch(() => json(OK_BODY));

    await createMistralProvider({ apiKey: "k-1", fetch }).complete(REQUEST);

    expect(calls[0]?.url).toBe(MISTRAL_CHAT_URL);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({ authorization: "Bearer k-1" });
    expect(sentBody(calls[0])).toEqual({
      model: "mistral-small-latest",
      messages: REQUEST.messages,
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits the JSON mode for text requests", async () => {
    const { fetch, calls } = fakeFetch(() => json(OK_BODY));

    await createMistralProvider({ apiKey: "k", fetch }).complete({
      ...REQUEST,
      responseFormat: "text",
    });

    expect(sentBody(calls[0])).not.toHaveProperty("response_format");
  });

  it("returns the content, the answering model and the usage", async () => {
    const { fetch } = fakeFetch(() => json(OK_BODY));

    expect(await createMistralProvider({ apiKey: "k", fetch }).complete(REQUEST)).toEqual({
      content: '{"a":1}',
      model: "mistral-small-2506",
      usage: { inputTokens: 321, outputTokens: 12 },
    });
  });

  it.each([
    [408, "timeout", true],
    [429, "rate_limited", true],
    [500, "server", true],
    [503, "server", true],
    [400, "client", false],
    [401, "client", false],
  ] as const)("classifies HTTP %i as %s", async (status, kind, retryable) => {
    const { fetch } = fakeFetch(() => json({ message: "mi chiamo Mariangela" }, status));

    const error = await failure(createMistralProvider({ apiKey: "k", fetch }).complete(REQUEST));

    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(retryable);
    expect(error.message).not.toContain("Mariangela");
  });

  it("classifies timeouts and network failures", async () => {
    const timeout = createMistralProvider({
      apiKey: "k",
      fetch: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
    });
    const offline = createMistralProvider({
      apiKey: "k",
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    expect((await failure(timeout.complete(REQUEST))).kind).toBe("timeout");
    expect((await failure(offline.complete(REQUEST))).kind).toBe("network");
  });

  it.each([
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
    ["no choices", () => json({ ...OK_BODY, choices: [] })],
    ["empty content", () => json({ ...OK_BODY, choices: [{ message: { content: "" } }] })],
  ])("rejects %s as an invalid response", async (_name, respond) => {
    const { fetch } = fakeFetch(respond);

    expect(
      (await failure(createMistralProvider({ apiKey: "k", fetch }).complete(REQUEST))).kind,
    ).toBe("invalid_response");
  });
  it("never puts the prompt or the response body in an error message", async () => {
    const leaky = [
      () => Promise.reject(new TypeError("fetch failed: mi chiamo Mariangela")),
      () => Promise.reject(new DOMException("mi chiamo Mariangela", "TimeoutError")),
      () => Promise.resolve(new Response("mi chiamo Mariangela", { status: 200 })),
      () => Promise.resolve(json({ ...OK_BODY, choices: [], echo: "mi chiamo Mariangela" })),
    ];
    for (const respond of leaky) {
      const error = await failure(
        createMistralProvider({ apiKey: "k-secret", fetch: respond }).complete(REQUEST),
      );
      expect(error.message).not.toContain("Mariangela");
      expect(error.message).not.toContain("k-secret");
    }
  });
});
