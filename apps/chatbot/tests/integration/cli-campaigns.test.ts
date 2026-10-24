import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../../src/cli/deps";
import { runCli, seedViaCli } from "./helpers/cli";
import { createTestDatabase, resetBotSchema } from "./helpers/database";

const db = createTestDatabase();
const STANDARD_PATH = join(__dirname, "../../campaigns/kubri-standard.json");

beforeEach(async () => {
  await resetBotSchema(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("campaigns import and list", () => {
  it("imports, re-imports without a new version, and lists", async () => {
    await seedViaCli(db);

    const first = await runCli(db, ["campaigns", "import", STANDARD_PATH, "--activate"]);
    const second = await runCli(db, ["campaigns", "import", STANDARD_PATH, "--activate"]);
    const list = await runCli(db, ["campaigns", "list"]);

    expect(first.error).toBeUndefined();
    expect(first.stdout[0]).toMatch(/created version 1, active$/);
    // The warnings of a successful import are printed, with the effective environment.
    expect(first.stderr.filter((l) => l.includes("placeholder_consent"))).toHaveLength(4);
    expect(first.stderr.at(-1)).toContain("NODE_ENV=development");
    expect(second.stdout[0]).toMatch(/unchanged, reusing version 1, active$/);
    expect(await db.campaignVersion.count()).toBe(1);
    expect(list.stdout).toEqual([
      "kubri-standard  [active]  org=kubri  sender=kubri-main  active=v1  latest=v1  trigger=default",
    ]);
  });

  it("imports without activating by default", async () => {
    await seedViaCli(db);

    const { stdout } = await runCli(db, ["campaigns", "import", STANDARD_PATH]);

    expect(stdout[0]).toMatch(/created version 1, not active \(use --activate\)$/);
  });

  it("refuses placeholder consents in production, writes nothing and names the environment", async () => {
    await seedViaCli(db);

    const { stderr, error } = await runCli(
      db,
      ["campaigns", "import", STANDARD_PATH, "--activate"],
      "production",
    );

    expect(error).toBeInstanceOf(CliError);
    expect(stderr.filter((l) => l.includes("placeholder_consent"))).toHaveLength(4);
    expect(stderr.at(-1)).toContain("NODE_ENV=production (placeholder consents are errors");
    expect(await db.campaign.count()).toBe(0);
  });

  it("refuses placeholder consents when NODE_ENV is unset", async () => {
    await seedViaCli(db);

    const { stderr, error } = await runCli(db, ["campaigns", "import", STANDARD_PATH], "unset");

    expect(error).toBeInstanceOf(CliError);
    expect(stderr.at(-1)).toContain("NODE_ENV=unset");
    expect(await db.campaignVersion.count()).toBe(0);
  });

  it("stores who imported the version", async () => {
    await seedViaCli(db);

    await runCli(db, ["campaigns", "import", STANDARD_PATH, "--imported-by", "daniele"]);

    expect((await db.campaignVersion.findFirstOrThrow()).importedBy).toBe("daniele");
  });

  it("explains a refused import and fails", async () => {
    // No organization and no sender yet.
    const { stderr, error } = await runCli(db, ["campaigns", "import", STANDARD_PATH]);

    expect(error).toBeInstanceOf(CliError);
    expect(stderr.join("\n")).toContain("unknown_organization");
  });

  it("says when there are no campaigns", async () => {
    expect((await runCli(db, ["campaigns", "list"])).stdout).toEqual(["No campaigns."]);
  });
});
