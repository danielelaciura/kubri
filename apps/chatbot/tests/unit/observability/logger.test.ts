import { describe, expect, it } from "vitest";
import { createLogger } from "../../../src/observability/logger";

function captureLogger() {
  const lines: string[] = [];
  const logger = createLogger({
    level: "info",
    destination: {
      write(message: string) {
        lines.push(message);
      },
    },
  });
  const entries = (): Record<string, unknown>[] =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, entries };
}

describe("createLogger", () => {
  it("redacts personal data at the top level", () => {
    const { logger, entries } = captureLogger();

    logger.info({ phone: "+393331234567", sessionId: "s-1" }, "turn processed");

    expect(entries()[0]).toMatchObject({
      phone: "[REDACTED]",
      sessionId: "s-1",
      msg: "turn processed",
    });
  });

  it("redacts personal data one level deep", () => {
    const { logger, entries } = captureLogger();

    logger.info({ contact: { firstName: "Mario", address: "Via Roma 1", id: "c-1" } });

    expect(entries()[0]?.["contact"]).toEqual({
      firstName: "[REDACTED]",
      address: "[REDACTED]",
      id: "c-1",
    });
  });

  it("redacts message bodies and credentials", () => {
    const { logger, entries } = captureLogger();

    logger.info({ message: { body: "ho la patente" }, authorization: "Bearer x" });

    expect(entries()[0]).toMatchObject({
      message: { body: "[REDACTED]" },
      authorization: "[REDACTED]",
    });
  });

  it("does not add pid and hostname to every line", () => {
    const { logger, entries } = captureLogger();

    logger.info("hello");

    expect(entries()[0]).not.toHaveProperty("pid");
    expect(entries()[0]).not.toHaveProperty("hostname");
  });

  it("redacts HTTP headers and cookies", () => {
    const { logger, entries } = captureLogger();

    logger.info({
      req: {
        headers: {
          authorization: "Bearer x",
          "x-hub-signature-256": "sha256=abc",
          cookie: "a=b",
          host: "h",
        },
      },
      headers: { Authorization: "Bearer y", "X-Hub-Signature-256": "sha256=def" },
    });

    expect(entries()[0]).toEqual({
      level: 30,
      time: expect.any(Number) as unknown,
      req: {
        headers: {
          authorization: "[REDACTED]",
          "x-hub-signature-256": "[REDACTED]",
          cookie: "[REDACTED]",
          host: "h",
        },
      },
      headers: { Authorization: "[REDACTED]", "X-Hub-Signature-256": "[REDACTED]" },
    });
  });

  it("redacts deeply nested keys and keys inside arrays", () => {
    const { logger, entries } = captureLogger();

    logger.info({
      a: { b: { phone: "+39333", id: "x" } },
      contacts: [{ phone: "+39333", id: "c-1" }],
    });

    expect(entries()[0]).toMatchObject({
      a: { b: { phone: "[REDACTED]", id: "x" } },
      contacts: [{ phone: "[REDACTED]", id: "c-1" }],
    });
  });

  it("redacts a WhatsApp-like webhook payload", () => {
    const { logger, entries } = captureLogger();

    logger.info({
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              value: {
                contacts: [{ wa_id: "39333", profile: { name: "Mario" } }],
                messages: [{ id: "wamid.1", from: "39333", text: { body: "ciao" } }],
              },
            },
          ],
        },
      ],
    });

    expect(entries()[0]).toMatchObject({
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              value: {
                contacts: [{ wa_id: "[REDACTED]", profile: { name: "[REDACTED]" } }],
                messages: [{ id: "wamid.1", from: "[REDACTED]", text: "[REDACTED]" }],
              },
            },
          ],
        },
      ],
    });
  });

  it("redacts extra keys and the database URL", () => {
    const { logger, entries } = captureLogger();

    logger.info({
      phoneNumber: "1",
      DATABASE_URL: "postgresql://u:p@h/db",
      config: { databaseUrl: "x" },
    });

    expect(entries()[0]).toMatchObject({
      phoneNumber: "[REDACTED]",
      DATABASE_URL: "[REDACTED]",
      config: { databaseUrl: "[REDACTED]" },
    });
  });
});
