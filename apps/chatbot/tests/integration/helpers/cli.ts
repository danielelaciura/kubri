import { readFileSync } from "node:fs";
import type { CliDeps } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import type { NodeEnv } from "../../../src/config/env";
import type { Database } from "../../../src/store/db";

export interface CliRun {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly error: unknown;
}

/**
 * Runs the CLI on the real test database and real files; only the output is captured.
 * NODE_ENV is pinned explicitly: the placeholder guard must not depend on the machine.
 */
export async function runCli(
  db: Database,
  args: string[],
  nodeEnv: NodeEnv | undefined = "development",
): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: CliDeps = {
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    readFile: (path) => Promise.resolve(readFileSync(path, "utf8")),
    nodeEnv: () => nodeEnv,
    // The test owns the connection: commands must not disconnect it.
    withDatabase: (fn) => fn(db),
  };
  let error: unknown;
  try {
    await createProgram(deps).parseAsync(["node", "kubri-bot", ...args]);
  } catch (e: unknown) {
    error = e;
  }
  return { stdout, stderr, error };
}

export const SENDER_ADD_ARGS = [
  "senders",
  "add",
  "kubri-main",
  "--phone",
  "+393331234567",
  "--name",
  "Kubri",
  "--org",
  "kubri",
  "--phone-number-id",
  "123456789012345",
  "--waba-id",
  "987654321098765",
  "--token-secret",
  "META_TOKEN_KUBRI_MAIN",
];

/** The organization and sender the standard campaign refers to, created through the CLI. */
export async function seedViaCli(db: Database): Promise<void> {
  await runCli(db, ["orgs", "add", "kubri", "--name", "Kubri S.r.l."]);
  await runCli(db, SENDER_ADD_ARGS);
}
