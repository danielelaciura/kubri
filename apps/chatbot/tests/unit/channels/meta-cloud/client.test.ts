import { describe, expect, it } from "vitest";
import type { OutboundText } from "../../../../src/channels/channel";
import { createMetaCloudChannel, type FetchLike } from "../../../../src/channels/meta-cloud/client";

const CONFIG = {
  phoneNumberId: "123456789012345",
  wabaId: "987654321098765",
  accessTokenSecret: "META_TOKEN_KUBRI_MAIN",
};
const MESSAGE: OutboundText = {
  clientMessageId: "m1",
  sender: { id: "s1", slug: "kubri-main", provider: "meta", providerConfig: CONFIG },
  to: { externalId: "393334445566", phoneE164: "+393334445566" },
  text: "Ciao",
};

interface Call {
  url: string;
  init: RequestInit;
}

function channel(
  respond: () => Response | Promise<Response>,
  secrets: Record<string, string> = { META_TOKEN_KUBRI_MAIN: "tok-123" },
) {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(respond());
  };
  return {
    calls,
    channel: createMetaCloudChannel({
      graphVersion: "v23.0",
      secret: (name) => secrets[name],
      fetch,
    }),
  };
}

const failing = (error: unknown) =>
  createMetaCloudChannel({
    graphVersion: "v23.0",
    secret: () => "t",
    fetch: () => Promise.reject(error instanceof Error ? error : new Error("boom")),
  });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function bodyOf(call: Call | undefined): unknown {
  const body = call?.init.body;
  if (typeof body !== "string") throw new Error("expected a JSON string body");
  return JSON.parse(body);
}
const OK = {
  messaging_product: "whatsapp",
  contacts: [{ wa_id: "393334445566" }],
  messages: [{ id: "wamid.OUT1" }],
};

describe("createMetaCloudChannel", () => {
  it("declares what it supports (D115, D119)", () => {
    const { channel: c } = channel(() => json(OK));

    expect(c.supportsInteractive).toBe(true);
    expect(c.freeFormWindowMs).toBe(24 * 60 * 60 * 1000);
  });

  it("posts the message to the number's endpoint with the token named in its configuration", async () => {
    const { channel: c, calls } = channel(() => json(OK));

    const outcome = await c.send(MESSAGE);

    expect(outcome).toEqual({ ok: true, providerMessageId: "wamid.OUT1" });
    expect(calls[0]?.url).toBe("https://graph.facebook.com/v23.0/123456789012345/messages");
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: "Bearer tok-123",
      "content-type": "application/json",
    });
    expect(bodyOf(calls[0])).toMatchObject({ type: "text", to: "393334445566" });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the choices as a widget", async () => {
    const { channel: c, calls } = channel(() => json(OK));

    await c.send({
      ...MESSAGE,
      choices: {
        listButton: "Scegli",
        options: [
          { id: "q:patente:yes", title: "Sì" },
          { id: "q:patente:no", title: "No" },
        ],
      },
    });

    expect(bodyOf(calls[0])).toMatchObject({
      type: "interactive",
      interactive: { type: "button" },
    });
  });

  it.each([
    [400, { error: { code: 131047 } }, "permanent", "outside_window"],
    [429, {}, "transient", "rate_limited"],
    [500, {}, "transient", "http_500"],
  ])("classifies HTTP %i", async (status, body, kind, code) => {
    const { channel: c } = channel(() => json(body, status));

    expect(await c.send(MESSAGE)).toEqual({ ok: false, kind, code });
  });

  it("classifies an error whose body is not JSON by its HTTP status", async () => {
    const { channel: c } = channel(() => new Response("<html>bad gateway</html>", { status: 502 }));

    expect(await c.send(MESSAGE)).toEqual({ ok: false, kind: "transient", code: "http_502" });
  });

  it("treats a timeout and a network failure as transient", async () => {
    expect(await failing(new DOMException("t", "TimeoutError")).send(MESSAGE)).toEqual({
      ok: false,
      kind: "transient",
      code: "timeout",
    });
    expect(await failing(new TypeError("fetch failed")).send(MESSAGE)).toEqual({
      ok: false,
      kind: "transient",
      code: "network",
    });
  });

  it("treats a 200 with no message id as a transient failure", async () => {
    const { channel: c } = channel(() => json({ messaging_product: "whatsapp" }));

    expect(await c.send(MESSAGE)).toEqual({
      ok: false,
      kind: "transient",
      code: "invalid_response",
    });
  });

  it("fails for good, without calling Meta, on a missing secret or a bad configuration", async () => {
    const noSecret = channel(() => json(OK), {});
    const badConfig = channel(() => json(OK));

    expect(await noSecret.channel.send(MESSAGE)).toEqual({
      ok: false,
      kind: "permanent",
      code: "missing_secret",
    });
    expect(
      await badConfig.channel.send({
        ...MESSAGE,
        sender: { ...MESSAGE.sender, providerConfig: {} },
      }),
    ).toEqual({ ok: false, kind: "permanent", code: "bad_sender_config" });
    expect(noSecret.calls).toHaveLength(0);
    expect(badConfig.calls).toHaveLength(0);
  });

  it("acknowledges a message and never throws", async () => {
    const ok = channel(() => json({ success: true }));

    await ok.channel.acknowledge?.("wamid.IN1", MESSAGE.sender);
    await expect(
      failing(new Error("boom")).acknowledge?.("wamid.IN1", MESSAGE.sender),
    ).resolves.toBeUndefined();

    expect(bodyOf(ok.calls[0])).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.IN1",
      typing_indicator: { type: "text" },
    });
  });

  describe("uploadDocument (R8)", () => {
    const FILE = {
      bytes: new Uint8Array([37, 80, 68, 70, 45]),
      filename: "CV.pdf",
      mimeType: "application/pdf" as const,
    };

    it("posts the file as multipart to the number's media endpoint", async () => {
      const { channel: c, calls } = channel(() => json({ id: "media-42" }));

      const outcome = await c.uploadDocument?.(FILE, MESSAGE.sender);

      expect(outcome).toEqual({ ok: true, mediaId: "media-42" });
      expect(calls[0]?.url).toBe("https://graph.facebook.com/v23.0/123456789012345/media");
      expect(calls[0]?.init.method).toBe("POST");
      expect(calls[0]?.init.headers).toEqual({ authorization: "Bearer tok-123" });
      expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
      const form = calls[0]?.init.body;
      if (!(form instanceof FormData)) throw new Error("expected a multipart body");
      expect(form.get("messaging_product")).toBe("whatsapp");
      expect(form.get("type")).toBe("application/pdf");
      expect(form.get("file")).toBeInstanceOf(File);
    });

    it.each([
      [400, { error: { code: 100 } }, "permanent", "invalid_request"],
      [429, {}, "transient", "rate_limited"],
      [503, {}, "transient", "http_503"],
    ])("classifies HTTP %i like a send", async (status, body, kind, code) => {
      const { channel: c } = channel(() => json(body, status));

      expect(await c.uploadDocument?.(FILE, MESSAGE.sender)).toEqual({ ok: false, kind, code });
    });

    it("treats a timeout, a network failure and a reply with no id as transient", async () => {
      expect(
        await failing(new DOMException("t", "TimeoutError")).uploadDocument?.(FILE, MESSAGE.sender),
      ).toEqual({ ok: false, kind: "transient", code: "timeout" });
      expect(
        await failing(new TypeError("fetch failed")).uploadDocument?.(FILE, MESSAGE.sender),
      ).toEqual({ ok: false, kind: "transient", code: "network" });
      const { channel: c } = channel(() => json({}));
      expect(await c.uploadDocument?.(FILE, MESSAGE.sender)).toEqual({
        ok: false,
        kind: "transient",
        code: "invalid_response",
      });
    });

    it("fails for good, without calling Meta, on a missing secret", async () => {
      const { channel: c, calls } = channel(() => json({ id: "m" }), {});

      expect(await c.uploadDocument?.(FILE, MESSAGE.sender)).toEqual({
        ok: false,
        kind: "permanent",
        code: "missing_secret",
      });
      expect(calls).toHaveLength(0);
    });

    it("never puts the token in an error", async () => {
      const { channel: c } = channel(() =>
        json({ error: { code: 190, message: "Bearer tok-123 expired" } }, 401),
      );

      expect(JSON.stringify(await c.uploadDocument?.(FILE, MESSAGE.sender))).not.toContain(
        "tok-123",
      );
    });
  });

  it("sends a document message with the uploaded media id", async () => {
    const { channel: c, calls } = channel(() => json(OK));

    await c.send({
      ...MESSAGE,
      text: "Ecco il tuo CV",
      document: { mediaId: "media-42", filename: "CV.pdf" },
    });

    expect(calls[0]?.url).toBe("https://graph.facebook.com/v23.0/123456789012345/messages");
    expect(bodyOf(calls[0])).toMatchObject({
      type: "document",
      document: { id: "media-42", filename: "CV.pdf", caption: "Ecco il tuo CV" },
    });
  });

  it("never puts the token in an error", async () => {
    const { channel: c } = channel(() =>
      json({ error: { code: 190, message: "Bearer tok-123 expired" } }, 401),
    );

    expect(JSON.stringify(await c.send(MESSAGE))).not.toContain("tok-123");
  });
});
