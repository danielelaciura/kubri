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
});

describe("ConsoleChannel", () => {
  it("prints the message to the given writer", async () => {
    const lines: string[] = [];

    const outcome = await new ConsoleChannel((line) => lines.push(line)).send(MESSAGE);

    expect(outcome).toEqual({ ok: true, providerMessageId: "console-1" });
    expect(lines).toEqual(["→ +393331112233: Ciao"]);
  });
});
