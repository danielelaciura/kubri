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

    await expect(
      run(["worker", "start", "--channel", "meta", "--nlu", "llm", "--translator", "llm"]),
    ).rejects.toThrow(/QUEUE_DATABASE_URL is not set/);
  });
});

describe("worker start in production (C9)", () => {
  function production(): void {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", APP_URL);
    vi.stubEnv("CONSENT_HASH_SECRET", SECRET);
    vi.stubEnv("QUEUE_DATABASE_URL", "postgresql://u:p@db.example.com:5432/postgres");
    vi.stubEnv("MISTRAL_API_KEY", "");
  }
  const REAL = ["--channel", "meta", "--nlu", "llm", "--translator", "llm"];

  it.each([
    [["--channel", "console", "--nlu", "llm", "--translator", "llm"], /--channel console/],
    [["--channel", "meta", "--nlu", "naive", "--translator", "llm"], /--nlu naive/],
    [["--channel", "meta", "--nlu", "llm", "--translator", "fake"], /--translator fake/],
    [[], /--channel console/],
  ])("refuses the fakes %j, in one line, before connecting", async (args, pattern) => {
    production();

    const started = run(["worker", "start", ...args]);

    await expect(started).rejects.toBeInstanceOf(CliError);
    await expect(started).rejects.toThrow(pattern);
  });

  it("explains a bad META_GRAPH_VERSION as a CLI error", async () => {
    production();
    vi.stubEnv("META_GRAPH_VERSION", "latest");

    const started = run(["worker", "start", ...REAL]);

    await expect(started).rejects.toBeInstanceOf(CliError);
    await expect(started).rejects.toThrow(/META_GRAPH_VERSION/);
  });
});

describe("web start", () => {
  it("refuses to start without the Meta secrets, before touching the database", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", APP_URL);
    vi.stubEnv("META_APP_SECRET", "");
    vi.stubEnv("META_VERIFY_TOKEN", "");

    const started = run(["web", "start"]);

    await expect(started).rejects.toBeInstanceOf(CliError);
    await expect(started).rejects.toThrow(/META_APP_SECRET/);
  });
});

describe("inbound send", () => {
  it("rejects a sender phone that is not E.164, before touching the database", async () => {
    const sent = run(["inbound", "send", "--sender", "kubri-main", "--from", "3331112233", "ciao"]);

    await expect(sent).rejects.toBeInstanceOf(CliError);
    await expect(sent).rejects.toThrow(/--from must be an E.164 number/);
  });
});
