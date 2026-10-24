import { readFile } from "node:fs/promises";
import { parseEnv, parseNodeEnv } from "../config/env";
import { createDatabase } from "../store/db";
import type { CliDeps } from "./deps";
import { runProgram } from "./run";

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

process.exitCode = await runProgram(deps, process.argv, process.env["KUBRI_BOT_DEBUG"] === "1");
