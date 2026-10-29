import { CliError, type CliDeps } from "./deps";
import { createProgram } from "./program";

/**
 * Runs the CLI and returns the process exit code. A `CliError` prints its message; any other
 * failure (bad or missing DATABASE_URL, database down, …) prints a single readable line:
 * the message only, no stack. Set `debug` (KUBRI_BOT_DEBUG=1) to get the full stack.
 */
export async function runProgram(
  deps: CliDeps,
  argv: readonly string[],
  debug: boolean,
): Promise<number> {
  try {
    await createProgram(deps).parseAsync([...argv]);
    return 0;
  } catch (error: unknown) {
    if (error instanceof CliError) {
      deps.err(error.message);
      return error.exitCode;
    }
    if (debug && error instanceof Error && error.stack) {
      deps.err(error.stack);
    } else {
      deps.err(oneLine(error));
    }
    return 1;
  }
}

/**
 * Prisma errors are a multi-line code frame that never says why (the reason is in `code`,
 * e.g. ECONNREFUSED): print the code instead. Anything else keeps its last line.
 */
function oneLine(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const lines = error.message.split("\n").map((line) => line.trim());
  const nonEmpty = lines.filter((line) => line !== "");
  if (nonEmpty[0]?.startsWith("Invalid `")) {
    const code = "code" in error && typeof error.code === "string" ? error.code : "unknown";
    return `${error.name}: database request failed (${code})`;
  }
  return `${error.name}: ${nonEmpty.at(-1) ?? "unknown error"}`;
}
