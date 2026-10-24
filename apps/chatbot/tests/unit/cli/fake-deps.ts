import type { CliDeps } from "../../../src/cli/deps";
import type { NodeEnv } from "../../../src/config/env";

export interface FakeCli {
  readonly deps: CliDeps;
  readonly stdout: string[];
  readonly stderr: string[];
}

/**
 * In-memory files, captured output, and a database that must not be touched.
 * `"unset"` simulates a missing NODE_ENV (the placeholder guard treats it as production).
 */
export function fakeCli(
  files: Record<string, string> = {},
  nodeEnv: NodeEnv | "unset" = "test",
): FakeCli {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: CliDeps = {
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    readFile: (path) => {
      const content = files[path];
      return content === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(content);
    },
    nodeEnv: () => (nodeEnv === "unset" ? undefined : nodeEnv),
    withDatabase: () => Promise.reject(new Error("unit tests must not open the database")),
  };
  return { deps, stdout, stderr };
}
