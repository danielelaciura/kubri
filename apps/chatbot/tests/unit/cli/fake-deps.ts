import type { CliDeps } from "../../../src/cli/deps";
import type { NodeEnv } from "../../../src/config/env";
import { parseNluConfig } from "../../../src/nlu/config";
import type { LlmProvider } from "../../../src/nlu/llm-provider";

export interface FakeCli {
  readonly deps: CliDeps;
  readonly stdout: string[];
  readonly stderr: string[];
  /** True once a command closed the keyboard input it opened. */
  inputClosed: () => boolean;
}

/**
 * In-memory files, captured output, scripted keyboard lines, a fixed clock, and a database
 * that must not be touched. `"unset"` simulates a missing NODE_ENV (the placeholder guard
 * treats it as production).
 */
export function fakeCli(
  files: Record<string, string> = {},
  nodeEnv: NodeEnv | "unset" = "test",
  inputs: readonly string[] = [],
  /** The fake LLM for `--nlu llm` / `--translator llm`; without it the LLM is off limits. */
  llm?: LlmProvider,
): FakeCli {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const queue = [...inputs];
  let closed = false;
  let minute = 0;
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
    openInput: () => ({
      next: () => Promise.resolve(queue.shift() ?? null),
      close: () => {
        closed = true;
      },
    }),
    now: () => new Date(Date.UTC(2026, 9, 24, 10, minute++)).toISOString(),
    nlu: () => {
      if (!llm) throw new Error("unit tests never reach the real LLM");
      return { provider: llm, config: parseNluConfig({}) };
    },
  };
  return { deps, stdout, stderr, inputClosed: () => closed };
}
