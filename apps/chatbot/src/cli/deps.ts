import type { NodeEnv } from "../config/env";
import type { NluServices } from "../nlu/services";
import type { Database } from "../store/db";

/** Lines typed by the operator. */
export interface LineInput {
  /** Shows `prompt` and waits for one line; null at the end of the input (Ctrl-D). */
  next(prompt: string): Promise<string | null>;
  /** Releases stdin: without it the process would never exit. */
  close(): void;
}

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
  /** Opened by interactive commands (simulate), closed by them when they end. */
  readonly openInput: () => LineInput;
  /** The current time, ISO-8601: the engine gets time from its events. */
  readonly now: () => string;
  /** The LLM and its configuration, built only by commands that need them (D81). */
  readonly nlu: () => NluServices;
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
