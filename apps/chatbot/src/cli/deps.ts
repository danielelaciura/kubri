import type { NodeEnv } from "../config/env";
import type { Database } from "../store/db";

/** Everything a command touches outside itself, injected so commands are testable. */
export interface CliDeps {
  /** Writes one line to stdout. */
  readonly out: (line: string) => void;
  /** Writes one line to stderr. */
  readonly err: (line: string) => void;
  readonly readFile: (path: string) => Promise<string>;
  /**
   * Read lazily: `campaigns validate` must work without DATABASE_URL. `undefined` means
   * NODE_ENV is unset, which the placeholder-consent guard treats as production.
   */
  readonly nodeEnv: () => NodeEnv | undefined;
  /** Opens a connection for the duration of `fn`, then disconnects. */
  readonly withDatabase: <T>(fn: (db: Database) => Promise<T>) => Promise<T>;
}

/** A failure already explained to the user: main prints the message and exits non-zero. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}
