import { describe, expect, it } from "vitest";
import { CliError } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import { fakeCli } from "./fake-deps";

describe("senders add", () => {
  it("rejects a blank name before touching the database", async () => {
    const cli = fakeCli();
    const run = createProgram(cli.deps).parseAsync([
      "node",
      "kubri-bot",
      "senders",
      "add",
      "kubri-main",
      "--phone",
      "+393331234567",
      "--name",
      "   ",
      "--phone-number-id",
      "123456789012345",
      "--waba-id",
      "987654321098765",
      "--token-secret",
      "META_TOKEN_KUBRI_MAIN",
    ]);

    await expect(run).rejects.toBeInstanceOf(CliError);
    await expect(run).rejects.toThrow(/--name cannot be empty/);
  });
});
