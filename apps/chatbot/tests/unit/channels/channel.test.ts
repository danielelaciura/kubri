import { describe, expect, it } from "vitest";
import { ConsoleChannel, FakeChannel, type OutboundText } from "../../../src/channels/channel";

const MESSAGE: OutboundText = {
  clientMessageId: "m1",
  sender: { id: "s1", slug: "kubri-main", provider: "meta", providerConfig: {} },
  to: { externalId: "393331112233", phoneE164: "+393331112233" },
  text: "Ciao",
};

describe("FakeChannel", () => {
  it("records what it sends and numbers the provider ids", async () => {
    const channel = new FakeChannel();

    expect(await channel.send(MESSAGE)).toEqual({ ok: true, providerMessageId: "fake-1" });
    expect(await channel.send({ ...MESSAGE, text: "Dopo" })).toEqual({
      ok: true,
      providerMessageId: "fake-2",
    });
    expect(channel.sent.map((m) => m.text)).toEqual(["Ciao", "Dopo"]);
  });

  it("plays a script of outcomes first, without recording the failed attempts", async () => {
    const channel = new FakeChannel([
      { ok: false, kind: "transient", code: "rate_limited" },
      { ok: false, kind: "permanent", code: "not_reachable" },
    ]);

    expect(await channel.send(MESSAGE)).toEqual({
      ok: false,
      kind: "transient",
      code: "rate_limited",
    });
    expect(await channel.send(MESSAGE)).toEqual({
      ok: false,
      kind: "permanent",
      code: "not_reachable",
    });
    expect(await channel.send(MESSAGE)).toMatchObject({ ok: true });
    expect(channel.sent).toHaveLength(1);
  });

  it("can be told to throw, like a broken adapter", async () => {
    const channel = new FakeChannel();
    channel.throwOnNext(new Error("socket hang up"));

    await expect(channel.send(MESSAGE)).rejects.toThrow("socket hang up");
    expect(await channel.send(MESSAGE)).toMatchObject({ ok: true });
  });

  it("adds outcomes to its script after it was built", async () => {
    const channel = new FakeChannel();
    channel.enqueueOutcome({ ok: false, kind: "transient", code: "rate_limited" });

    expect(await channel.send(MESSAGE)).toEqual({
      ok: false,
      kind: "transient",
      code: "rate_limited",
    });
    expect(await channel.send(MESSAGE)).toMatchObject({ ok: true });
    expect(channel.sent).toHaveLength(1);
  });
});

describe("ConsoleChannel", () => {
  it("prints the message to the given writer", async () => {
    const lines: string[] = [];

    const outcome = await new ConsoleChannel((line) => lines.push(line)).send(MESSAGE);

    expect(outcome).toEqual({ ok: true, providerMessageId: `console-${MESSAGE.clientMessageId}` });
    expect(lines).toEqual(["→ +393331112233: Ciao"]);
  });

  it("gives the same message the same id in every process: a restarted worker never collides", async () => {
    const first = await new ConsoleChannel(() => undefined).send(MESSAGE);
    const other = await new ConsoleChannel(() => undefined).send({
      ...MESSAGE,
      clientMessageId: "another-message",
    });

    expect(first).not.toEqual(other);
    expect(await new ConsoleChannel(() => undefined).send(MESSAGE)).toEqual(first);
  });
});

describe("channel capabilities", () => {
  const choices = {
    listButton: "Scegli",
    options: [
      { id: "q:patente:yes", title: "Sì" },
      { id: "q:patente:no", title: "No" },
    ],
  };

  it("the fake channel supports widgets and has no window until told", () => {
    const channel = new FakeChannel();

    expect(channel.supportsInteractive).toBe(true);
    expect(channel.freeFormWindowMs).toBeNull();
  });

  it("records the choices it is sent and the messages it acknowledges", async () => {
    const channel = new FakeChannel();

    await channel.send({ ...MESSAGE, choices });
    await channel.acknowledge("wamid.1", MESSAGE.sender);

    expect(channel.sent[0]?.choices).toEqual(choices);
    expect(channel.acknowledged).toEqual(["wamid.1"]);
  });

  it("the console channel shows the options under the text", async () => {
    const lines: string[] = [];

    await new ConsoleChannel((line) => lines.push(line)).send({ ...MESSAGE, choices });

    expect(lines).toEqual(["→ +393331112233: Ciao", "   [Sì] [No]"]);
  });
});

describe("documents (R8)", () => {
  const FILE = {
    bytes: new Uint8Array([37, 80, 68, 70, 45]),
    filename: "CV.pdf",
    mimeType: "application/pdf" as const,
  };
  const document = { mediaId: "media-1", filename: "CV.pdf" };

  it("the fake channel records the uploads and numbers the media ids", async () => {
    const channel = new FakeChannel();

    expect(await channel.uploadDocument(FILE, MESSAGE.sender)).toEqual({
      ok: true,
      mediaId: "fake-media-1",
    });
    expect(await channel.uploadDocument(FILE, MESSAGE.sender)).toEqual({
      ok: true,
      mediaId: "fake-media-2",
    });
    expect(channel.uploaded).toEqual([FILE, FILE]);
  });

  it("the fake channel plays scripted upload failures first, without recording them", async () => {
    const channel = new FakeChannel();
    channel.enqueueUploadOutcome({ ok: false, kind: "transient", code: "rate_limited" });

    expect(await channel.uploadDocument(FILE, MESSAGE.sender)).toEqual({
      ok: false,
      kind: "transient",
      code: "rate_limited",
    });
    expect(await channel.uploadDocument(FILE, MESSAGE.sender)).toEqual({
      ok: true,
      mediaId: "fake-media-1",
    });
    expect(channel.uploaded).toHaveLength(1);
  });

  it("the fake channel records the document it is sent", async () => {
    const channel = new FakeChannel();

    await channel.send({ ...MESSAGE, document });

    expect(channel.sent[0]?.document).toEqual(document);
  });

  it("the console channel shows the document under the text", async () => {
    const lines: string[] = [];
    const console = new ConsoleChannel((line) => lines.push(line));

    const upload = await console.uploadDocument(FILE, MESSAGE.sender);
    await console.send({ ...MESSAGE, text: "Ecco il tuo CV", document });

    expect(upload).toMatchObject({ ok: true });
    expect(lines).toEqual(["→ +393331112233: Ecco il tuo CV", "   [documento CV.pdf]"]);
  });
});
