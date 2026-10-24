import { describe, expect, it } from "vitest";
import { CliError } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import type { Database } from "../../../src/store/db";
import { minimalCampaign } from "../campaigns/fixtures";
import { fakeCli } from "./fake-deps";

/** A database whose transaction fails the way Prisma reports a lost race. */
function racingDatabase(code: string): Database {
  return failingDatabase(Object.assign(new Error("transaction failed"), { code }));
}

function failingDatabase(failure: Error): Database {
  return { $transaction: () => Promise.reject(failure) } as unknown as Database;
}

async function importWith(db: Database) {
  const cli = fakeCli({ "c.json": JSON.stringify(minimalCampaign()) }, "test");
  const deps = { ...cli.deps, withDatabase: <T>(fn: (d: Database) => Promise<T>) => fn(db) };
  let error: unknown;
  try {
    await createProgram(deps).parseAsync(["node", "kubri-bot", "campaigns", "import", "c.json"]);
  } catch (e: unknown) {
    error = e;
  }
  return { ...cli, error };
}

describe("campaigns import: concurrent imports", () => {
  it.each(["P2034", "P2002"])("tells the user to retry on Prisma %s", async (code) => {
    const { error } = await importWith(racingDatabase(code));

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain("import concorrente, riprova");
    expect((error as CliError).exitCode).toBe(1);
  });

  it.each([
    { kind: "TransactionWriteConflict" },
    { kind: "postgres", originalCode: "40001" },
    { kind: "UniqueConstraintViolation", constraint: { fields: ["version"] } },
    { kind: "postgres", originalCode: "23505" },
  ])("tells the user to retry on a driver adapter error %j", async (cause) => {
    // The Prisma pg adapter throws a DriverAdapterError: no `code`, the detail is in `cause`.
    const failure = Object.assign(new Error("TransactionWriteConflict"), {
      name: "DriverAdapterError",
      cause,
    });

    const { error } = await importWith(failingDatabase(failure));

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain("import concorrente, riprova");
  });

  it("does not hide unrelated database failures", async () => {
    const { error } = await importWith(racingDatabase("P1001"));

    expect(error).not.toBeInstanceOf(CliError);
    expect((error as Error).message).toBe("transaction failed");
  });
});
