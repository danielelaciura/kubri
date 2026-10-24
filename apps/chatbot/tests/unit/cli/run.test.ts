import { describe, expect, it } from "vitest";
import { CliError } from "../../../src/cli/deps";
import { runProgram } from "../../../src/cli/run";
import { minimalCampaign } from "../campaigns/fixtures";
import { fakeCli } from "./fake-deps";

const ORGS_ADD = ["node", "kubri-bot", "orgs", "add", "kubri", "--name", "Kubri"];

describe("runProgram", () => {
  it("returns 0 on success", async () => {
    const cli = fakeCli({ "c.json": JSON.stringify(minimalCampaign()) });
    const code = await runProgram(
      cli.deps,
      ["node", "kubri-bot", "campaigns", "validate", "c.json"],
      false,
    );
    expect(code).toBe(0);
    expect(cli.stdout).toHaveLength(1);
  });

  it("prints an expected failure as one line with its exit code", async () => {
    const cli = fakeCli();
    const code = await runProgram(
      cli.deps,
      ["node", "kubri-bot", "campaigns", "validate", "x"],
      false,
    );

    expect(code).toBe(1);
    expect(cli.stderr).toEqual(["Cannot read x"]);
  });

  it("prints an unexpected failure as one line, without a stack", async () => {
    const cli = fakeCli(); // withDatabase rejects, like a down database or a bad DATABASE_URL
    const code = await runProgram(cli.deps, ORGS_ADD, false);

    expect(code).toBe(1);
    expect(cli.stderr).toEqual(["Error: unit tests must not open the database"]);
  });

  it("replaces a Prisma code frame with its error code", async () => {
    const cli = fakeCli();
    const failure = Object.assign(
      new Error("\nInvalid `db.campaign.findMany()` invocation in\n/a/b.ts:1\n\n→ 153  code"),
      { name: "PrismaClientKnownRequestError", code: "ECONNREFUSED" },
    );
    cli.deps.withDatabase = () => Promise.reject(failure);

    expect(await runProgram(cli.deps, ORGS_ADD, false)).toBe(1);
    expect(cli.stderr).toEqual([
      "PrismaClientKnownRequestError: database request failed (ECONNREFUSED)",
    ]);
  });

  it("keeps the last line of any other multi-line error", async () => {
    const cli = fakeCli();
    cli.deps.withDatabase = () => Promise.reject(new Error("first\nsecond\n\nthe reason"));

    expect(await runProgram(cli.deps, ORGS_ADD, false)).toBe(1);
    expect(cli.stderr).toEqual(["Error: the reason"]);
  });

  it("prints the stack when debugging is on", async () => {
    const cli = fakeCli();
    const code = await runProgram(cli.deps, ORGS_ADD, true);

    expect(code).toBe(1);
    expect(cli.stderr.join("\n")).toContain("at ");
  });

  it("keeps the exit code of a CliError", async () => {
    const cli = fakeCli();
    cli.deps.withDatabase = () => Promise.reject(new CliError("nope", 3));
    expect(await runProgram(cli.deps, ORGS_ADD, false)).toBe(3);
    expect(cli.stderr).toEqual(["nope"]);
  });
});
