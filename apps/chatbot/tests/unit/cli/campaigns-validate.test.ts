import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliError } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import type { NodeEnv } from "../../../src/config/env";
import { minimalCampaign } from "../campaigns/fixtures";
import { fakeCli } from "./fake-deps";

const STANDARD = readFileSync(join(__dirname, "../../../campaigns/kubri-standard.json"), "utf8");

async function validate(content: string, nodeEnv: NodeEnv | "unset" = "test") {
  const cli = fakeCli({ "c.json": content }, nodeEnv);
  let error: unknown;
  try {
    await createProgram(cli.deps).parseAsync([
      "node",
      "kubri-bot",
      "campaigns",
      "validate",
      "c.json",
    ]);
  } catch (e: unknown) {
    error = e;
  }
  return { ...cli, error };
}

describe("campaigns validate", () => {
  it("confirms a valid campaign", async () => {
    const { stdout, error } = await validate(JSON.stringify(minimalCampaign()));

    expect(error).toBeUndefined();
    expect(stdout).toEqual(['✓ c.json: campaign "acme-magazzino" is valid']);
  });

  it("prints every issue with its path and fails", async () => {
    const input = minimalCampaign();
    input.texts = {};

    const { stderr, error } = await validate(JSON.stringify(input));

    expect(error).toBeInstanceOf(CliError);
    expect(stderr[0]).toBe("✗ c.json: 1 issue(s)");
    expect(stderr[1]).toContain("flow[1].on.idk.reply");
    expect(stderr[1]).toContain("unknown_text_ref");
  });

  it("fails on a file that is not JSON", async () => {
    const { error } = await validate("{ nope");

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/not valid JSON/);
  });

  it("fails on a missing file", async () => {
    const cli = fakeCli();
    await expect(
      createProgram(cli.deps).parseAsync(["node", "kubri-bot", "campaigns", "validate", "x.json"]),
    ).rejects.toThrow(/Cannot read x.json/);
  });

  it.each<NodeEnv>(["development", "test"])(
    "warns about placeholder consents when NODE_ENV=%s",
    async (nodeEnv) => {
      const { stdout, stderr, error } = await validate(STANDARD, nodeEnv);

      expect(error).toBeUndefined();
      // Two consents: a placeholder version plus a [TESTO SEGNAPOSTO] marker each.
      expect(stderr.filter((line) => line.includes("placeholder_consent"))).toHaveLength(4);
      expect(stderr.at(-1)).toContain(`NODE_ENV=${nodeEnv} (placeholder consents are warnings)`);
      expect(stdout[0]).toContain("is valid");
    },
  );

  it("fails on placeholder consents in production and says which environment applied", async () => {
    const { error, stderr, stdout } = await validate(STANDARD, "production");

    expect(error).toBeInstanceOf(CliError);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("not publishable");
    expect(stderr.filter((line) => line.includes("placeholder_consent"))).toHaveLength(4);
    expect(stderr.at(-1)).toContain("NODE_ENV=production (placeholder consents are errors");
  });

  it("treats an unset NODE_ENV as production and says so", async () => {
    const { error, stderr } = await validate(STANDARD, "unset");

    expect(error).toBeInstanceOf(CliError);
    expect(stderr.at(-1)).toContain("NODE_ENV=unset (placeholder consents are errors");
  });
});
