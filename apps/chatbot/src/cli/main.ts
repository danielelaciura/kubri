import { readFile } from "node:fs/promises";
import { parseEnv, parseNodeEnv } from "../config/env";
import { createDatabase } from "../store/db";
import { CliError, type CliDeps } from "./deps";
import { createProgram } from "./program";

const deps: CliDeps = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  readFile: (path) => readFile(path, "utf8"),
  nodeEnv: () => parseNodeEnv(process.env["NODE_ENV"]),
  withDatabase: async (fn) => {
    const db = createDatabase(parseEnv(process.env).DATABASE_URL);
    try {
      return await fn(db);
    } finally {
      await db.$disconnect();
    }
  },
};

try {
  await createProgram(deps).parseAsync(process.argv);
} catch (error: unknown) {
  if (!(error instanceof CliError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.exitCode;
}
