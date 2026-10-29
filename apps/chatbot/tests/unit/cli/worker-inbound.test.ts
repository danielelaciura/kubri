import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import { fakeCli } from "./fake-deps";

const SECRET = "test-consent-hash-secret-0123456789abcdef";
const APP_URL = "postgresql://u:p@localhost:54329/kubri_bot_dev?schema=bot";

function run(args: string[]): Promise<unknown> {
  return createProgram(fakeCli().deps).parseAsync(["node", "kubri-bot", ...args]);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("worker start", () => {
  it("refuses to start without CONSENT_HASH_SECRET, before touching the database", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", APP_URL);
    vi.stubEnv("CONSENT_HASH_SECRET", "");

    const started = run(["worker", "start"]);

    await expect(started).rejects.toBeInstanceOf(CliError);
    await expect(started).rejects.toThrow(/CONSENT_HASH_SECRET is not set/);
  });

  it("refuses to start in production without QUEUE_DATABASE_URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", APP_URL);
    vi.stubEnv("CONSENT_HASH_SECRET", SECRET);
    vi.stubEnv("QUEUE_DATABASE_URL", "");

    await expect(run(["worker", "start"])).rejects.toThrow(/QUEUE_DATABASE_URL is not set/);
  });
});

describe("inbound send", () => {
  it("rejects a sender phone that is not E.164, before touching the database", async () => {
    const sent = run(["inbound", "send", "--sender", "kubri-main", "--from", "3331112233", "ciao"]);

    await expect(sent).rejects.toBeInstanceOf(CliError);
    await expect(sent).rejects.toThrow(/--from must be an E.164 number/);
  });
});
