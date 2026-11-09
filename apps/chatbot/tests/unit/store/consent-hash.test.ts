import { describe, expect, it } from "vitest";
import { contactHash } from "../../../src/store/consents";

const SECRET = "test-consent-hash-secret-0123456789abcdef";

describe("contactHash", () => {
  it("is a stable keyed hash of channel and external id", () => {
    expect(contactHash(SECRET, "whatsapp", "3933311")).toMatch(/^[0-9a-f]{64}$/);
    expect(contactHash(SECRET, "whatsapp", "3933311")).toBe(
      contactHash(SECRET, "whatsapp", "3933311"),
    );
    expect(contactHash(SECRET, "whatsapp", "3933311")).not.toBe(
      contactHash(SECRET, "whatsapp", "3933312"),
    );
  });

  it("changes with the secret, so a phone number cannot be checked without it", () => {
    expect(contactHash(SECRET, "whatsapp", "3933311")).not.toBe(
      contactHash(`${SECRET}-other`, "whatsapp", "3933311"),
    );
  });

  it("is an HMAC, not a plain sha256 of the input", async () => {
    const { createHash } = await import("node:crypto");
    const plain = createHash("sha256").update("whatsapp:3933311", "utf8").digest("hex");

    expect(contactHash(SECRET, "whatsapp", "3933311")).not.toBe(plain);
  });
});
