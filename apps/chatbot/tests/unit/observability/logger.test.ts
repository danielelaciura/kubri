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
});
