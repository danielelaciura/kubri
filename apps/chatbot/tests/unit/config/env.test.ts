import { describe, expect, it } from "vitest";
import { parseEnv, parseNodeEnv } from "../../../src/config/env";

const VALID_URL = "postgresql://postgres:postgres@localhost:54329/kubri_bot_dev?schema=bot";

describe("parseEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = parseEnv({ DATABASE_URL: VALID_URL });

    expect(env).toEqual({
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      DATABASE_URL: VALID_URL,
      PORT: 3000,
    });
  });

  it("coerces PORT to a number", () => {
    expect(parseEnv({ DATABASE_URL: VALID_URL, PORT: "8080" }).PORT).toBe(8080);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a DATABASE_URL that does not target the bot schema", () => {
    const publicUrl = "postgresql://postgres:postgres@localhost:54329/kubri_bot_dev";
    expect(() => parseEnv({ DATABASE_URL: publicUrl })).toThrow(/schema=bot/);
  });

  it("does not leak the database password in the error message", () => {
    const secretUrl = "postgresql://postgres:s3cr3t@localhost:54329/db";
    let message = "";
    try {
      parseEnv({ DATABASE_URL: secretUrl });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain("s3cr3t");
  });
});

describe("parseNodeEnv", () => {
  it("returns undefined when unset (callers must treat it as strict)", () => {
    expect(parseNodeEnv(undefined)).toBeUndefined();
  });

  it("accepts production", () => {
    expect(parseNodeEnv("production")).toBe("production");
  });

  it("rejects unknown values", () => {
    expect(() => parseNodeEnv("prod")).toThrow(/NODE_ENV/);
  });
});
