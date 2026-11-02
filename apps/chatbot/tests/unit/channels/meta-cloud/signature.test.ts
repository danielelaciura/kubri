import { describe, expect, it } from "vitest";
import {
  signBody,
  verifyChallenge,
  verifySignature,
} from "../../../../src/channels/meta-cloud/signature";

const SECRET = "app-secret";
const BODY = Buffer.from('{"object":"whatsapp_business_account"}');

describe("verifySignature", () => {
  it("accepts the signature computed with the app secret", () => {
    expect(verifySignature(SECRET, BODY, signBody(SECRET, BODY))).toBe(true);
  });

  it("rejects a wrong secret, a changed body, and a malformed or missing header", () => {
    expect(verifySignature("other", BODY, signBody(SECRET, BODY))).toBe(false);
    expect(verifySignature(SECRET, Buffer.from("{}"), signBody(SECRET, BODY))).toBe(false);
    expect(verifySignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifySignature(SECRET, BODY, "sha1=abc")).toBe(false);
    expect(verifySignature(SECRET, BODY, "sha256=zz")).toBe(false);
    expect(verifySignature(SECRET, BODY, "sha256=")).toBe(false);
  });

  it("knows the signature format of Meta's documentation", () => {
    expect(signBody("secret", Buffer.from("hello"))).toBe(
      "sha256=88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b",
    );
  });
});

describe("verifyChallenge", () => {
  const params = (q: string) => new URLSearchParams(q);

  it("returns the challenge when mode and token match", () => {
    expect(
      verifyChallenge(
        params("hub.mode=subscribe&hub.verify_token=tok&hub.challenge=1158201444"),
        "tok",
      ),
    ).toBe("1158201444");
  });

  it.each([
    "hub.mode=unsubscribe&hub.verify_token=tok&hub.challenge=1",
    "hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1",
    "hub.mode=subscribe&hub.verify_token=to&hub.challenge=1",
    "hub.mode=subscribe&hub.challenge=1",
    "hub.mode=subscribe&hub.verify_token=tok",
    "",
  ])("rejects %j", (query) => {
    expect(verifyChallenge(params(query), "tok")).toBeNull();
  });
});
