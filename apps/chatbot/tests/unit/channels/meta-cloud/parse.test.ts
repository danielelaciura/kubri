import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWebhook } from "../../../../src/channels/meta-cloud/parse";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "../../../fixtures/meta", `${name}.json`), "utf8"));

describe("parseWebhook (D118)", () => {
  it("reads a text message", () => {
    const parsed = parseWebhook(fixture("text"));
    const [message] = parsed?.messages ?? [];

    expect(parsed?.messages).toHaveLength(1);
    expect({ ...message, raw: undefined }).toEqual({
      phoneNumberId: "123456789012345",
      providerMessageId: "wamid.TEXT1",
      from: { externalId: "393334445566", phoneE164: "+393334445566" },
      type: "text",
      body: "ciao",
      reply: null,
      receivedAt: new Date(1792836000 * 1000),
      raw: undefined,
    });
    expect(message?.raw).toMatchObject({ id: "wamid.TEXT1" });
    expect(parsed?.statuses).toEqual([]);
  });

  it("reads a tap on a button: the title is the body, the id is the reply", () => {
    const [message] = parseWebhook(fixture("interactive-button"))?.messages ?? [];

    expect(message).toMatchObject({
      type: "interactive",
      body: "Accetto",
      reply: { id: "consent:privacy:accepted", title: "Accetto" },
    });
  });

  it("reads a tap on a list row", () => {
    const [message] = parseWebhook(fixture("interactive-list"))?.messages ?? [];

    expect(message).toMatchObject({
      type: "interactive",
      body: "العربية",
      reply: { id: "lang:ar", title: "العربية" },
    });
  });

  it("keeps an audio message, with no body", () => {
    const [message] = parseWebhook(fixture("audio"))?.messages ?? [];

    expect(message).toMatchObject({ type: "audio", body: null, reply: null });
  });

  it("reads delivery statuses, with the error code of a failure", () => {
    expect(parseWebhook(fixture("status-delivered"))?.statuses).toEqual([
      {
        phoneNumberId: "123456789012345",
        providerMessageId: "wamid.OUT1",
        status: "delivered",
        at: new Date(1792836003 * 1000),
        errorCode: null,
      },
    ]);
    expect(parseWebhook(fixture("status-failed"))?.statuses[0]).toMatchObject({
      status: "failed",
      errorCode: 131047,
    });
  });

  it("reads every entry, change, message and status, and counts what it ignores", () => {
    const parsed = parseWebhook(fixture("multi"));

    expect(parsed?.messages.map((m) => m.providerMessageId)).toEqual(["wamid.M1", "wamid.M2"]);
    expect(parsed?.statuses.map((s) => s.status)).toEqual(["read"]);
    // The other field's change and the reaction.
    expect(parsed?.ignored).toBe(2);
    expect(parsed?.rejected).toEqual([]);
  });

  it("rejects a message it cannot read, keeping it, and still reads the others", () => {
    const payload = fixture("multi") as {
      entry: { changes: { value: { messages?: unknown[] } }[] }[];
    };
    payload.entry[0]?.changes[0]?.value.messages?.splice(1, 0, { id: "wamid.BAD", type: "text" });

    const parsed = parseWebhook(payload);

    expect(parsed?.messages).toHaveLength(2);
    expect(parsed?.rejected).toEqual([{ id: "wamid.BAD", type: "text" }]);
  });

  it("rejects a status it cannot read, and a messages change without metadata", () => {
    const payload = fixture("multi") as {
      entry: { changes: { field: string; value: unknown }[] }[];
    };
    payload.entry[1]?.changes.push({ field: "messages", value: { statuses: [] } });
    const first = payload.entry[0]?.changes[0]?.value as { statuses: unknown[] };
    first.statuses.push({ id: "wamid.OUT9", status: "deleted", timestamp: "1792836020" });

    const parsed = parseWebhook(payload);

    expect(parsed?.statuses).toHaveLength(1);
    expect(parsed?.rejected).toEqual([
      { id: "wamid.OUT9", status: "deleted", timestamp: "1792836020" },
      { statuses: [] },
    ]);
  });

  it("maps types it does not know to unsupported", () => {
    const payload = fixture("text") as {
      entry: { changes: { value: { messages: { type: string }[] } }[] }[];
    };
    const message = payload.entry[0]?.changes[0]?.value.messages[0];
    if (message) message.type = "sticker";

    expect(parseWebhook(payload)?.messages[0]).toMatchObject({ type: "unsupported", body: null });
  });

  it.each([
    null,
    "text",
    42,
    {},
    { object: "page", entry: [] },
    { object: "whatsapp_business_account" },
  ])("returns null for what is not a WhatsApp payload (%j)", (json) => {
    expect(parseWebhook(json)).toBeNull();
  });
});
