import { CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE as BODY } from "@kubri/contracts";
import { describe, expect, it } from "vitest";
import {
  createKubriClient,
  FakeKubriClient,
  KUBRI_TIMEOUT_MS,
  type FetchLike,
} from "../../../src/integrations/kubri/client";

interface Call {
  url: string;
  init: RequestInit;
}

const CONFIG = { baseUrl: "https://app.kubri.it", secret: "s3cret" };

function client(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(respond());
  };
  return { calls, client: createKubriClient(CONFIG, { fetch }) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const failing = (error: Error) => createKubriClient(CONFIG, { fetch: () => Promise.reject(error) });

describe("createKubriClient (spec §12.1, R6)", () => {
  it("posts the payload to the chatbot endpoint with the bearer secret and a timeout", async () => {
    const { client: c, calls } = client(() => json({ ok: true, candidateId: "cand-1" }));

    expect(await c.send(BODY)).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://app.kubri.it/api/webhooks/chatbot/candidate");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toEqual({
      authorization: "Bearer s3cret",
      "content-type": "application/json",
    });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(BODY);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(KUBRI_TIMEOUT_MS).toBe(15_000);
  });

  it("counts a send the dashboard skipped as stale as done (D125)", async () => {
    const { client: c } = client(() => json({ ok: true, skipped: "stale" }));

    expect(await c.send(BODY)).toEqual({ ok: true, skipped: "stale" });
  });

  it.each([
    [401, { error: "unauthorized" }, "permanent", "unauthorized"],
    [400, { error: "validation_failed", issues: [] }, "permanent", "validation_failed"],
    [400, { error: "invalid_json" }, "permanent", "invalid_json"],
    [422, { error: "unknown_pool", externalKey: "x" }, "permanent", "unknown_pool"],
    [404, "<html>not found</html>", "permanent", "http_404"],
    [403, { error: "Karim Benali is not allowed" }, "permanent", "http_403"],
    [500, { error: "internal_error" }, "transient", "http_500"],
    [502, {}, "transient", "http_502"],
    [429, {}, "transient", "http_429"],
    [408, {}, "transient", "http_408"],
  ] as const)("HTTP %i → %s (%s)", async (status, body, kind, code) => {
    const { client: c } = client(() =>
      typeof body === "string" ? new Response(body, { status }) : json(body, status),
    );

    expect(await c.send(BODY)).toEqual({ ok: false, kind, code, status });
  });

  it("treats a timeout and a network failure as transient", async () => {
    expect(await failing(new DOMException("t", "TimeoutError")).send(BODY)).toEqual({
      ok: false,
      kind: "transient",
      code: "timeout",
    });
    expect(await failing(new TypeError("fetch failed")).send(BODY)).toEqual({
      ok: false,
      kind: "transient",
      code: "network",
    });
  });

  it("never lets the secret or the payload into a result", async () => {
    const { client: c } = client(() =>
      json({ error: "unauthorized", echoed: "Bearer s3cret", first_name: "Karim" }, 401),
    );

    const serialized = JSON.stringify(await c.send(BODY));

    expect(serialized).not.toContain("s3cret");
    expect(serialized).not.toContain("Karim");
  });
});

describe("FakeKubriClient", () => {
  it("records what it is sent and plays a script first", async () => {
    const fake = new FakeKubriClient([
      { ok: false, kind: "transient", code: "http_500", status: 500 },
    ]);

    expect((await fake.send(BODY)).ok).toBe(false);
    expect(await fake.send(BODY)).toEqual({ ok: true });
    expect(fake.sent).toEqual([BODY]);
  });
});
