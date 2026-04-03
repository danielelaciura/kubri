import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { encrypt, decrypt } from "@/lib/encryption";

// A valid 32-byte key (64 hex chars)
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encryption", () => {
  beforeAll(() => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("should round-trip encrypt and decrypt a string", () => {
    const plaintext = "my-secret-api-token";
    const ciphertext = encrypt(plaintext);
    const result = decrypt(ciphertext);
    expect(result).toBe(plaintext);
  });

  it("should round-trip with empty string", () => {
    const plaintext = "";
    const ciphertext = encrypt(plaintext);
    const result = decrypt(ciphertext);
    expect(result).toBe(plaintext);
  });

  it("should round-trip with unicode content", () => {
    const plaintext = "ciao mondo! 🇮🇹 stringa con caratteri speciali";
    const ciphertext = encrypt(plaintext);
    const result = decrypt(ciphertext);
    expect(result).toBe(plaintext);
  });

  it("should produce different ciphertexts for the same input (random IV)", () => {
    const plaintext = "same-input";
    const ciphertext1 = encrypt(plaintext);
    const ciphertext2 = encrypt(plaintext);
    expect(ciphertext1).not.toBe(ciphertext2);
    // But both should decrypt to the same value
    expect(decrypt(ciphertext1)).toBe(plaintext);
    expect(decrypt(ciphertext2)).toBe(plaintext);
  });

  it("should produce ciphertext in iv:authTag:encrypted format", () => {
    const ciphertext = encrypt("test");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(3);
    // IV is 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // Auth tag is 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Encrypted part should exist
    expect(parts[2]!.length).toBeGreaterThan(0);
  });

  it("should throw on invalid ciphertext format", () => {
    expect(() => decrypt("invalid")).toThrow("Invalid ciphertext format");
  });

  it("should throw when ENCRYPTION_KEY is not set", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => encrypt("test")).toThrow();
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
  });
});
