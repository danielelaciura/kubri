import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { handleGeocoding } from "../../../../src/runtime/jobs/geocoding";

describe("handleGeocoding (D124, R7)", () => {
  it("closes the job with an info line naming the session, touching nothing", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "info" }, { write: (line: string) => lines.push(line) });

    await expect(handleGeocoding({ logger }, { sessionId: "s1" })).resolves.toBeUndefined();

    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({ level: 30, sessionId: "s1" });
    expect(line["msg"]).toContain("delegated to the dashboard");
  });
});
