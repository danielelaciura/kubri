import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseEnv, parseNodeEnv } from "../config/env";
import { createNluServices } from "../nlu/services";
import { createDatabase } from "../store/db";
import type { CliDeps } from "./deps";
import { runProgram } from "./run";

const deps: CliDeps = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  readFile: (path) => readFile(path, "utf8"),
  nodeEnv: () => parseNodeEnv(process.env["NODE_ENV"]),
  withDatabase: async (fn, options) => {
    const db = createDatabase(parseEnv(process.env).DATABASE_URL, options);
    try {
      return await fn(db);
    } finally {
      await db.$disconnect();
    }
  },
  openInput: () => {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    const lines = rl[Symbol.asyncIterator]();
    return {
      next: async (prompt) => {
        process.stdout.write(prompt);
        const line = await lines.next();
        if (line.done) {
          process.stdout.write("\n"); // leave the prompt's line after Ctrl-D / end of input
          return null;
        }
        // Piped input (a scripted run) is not echoed by the terminal: echo it for the transcript.
        if (!process.stdin.isTTY) process.stdout.write(`${line.value}\n`);
        return line.value;
      },
      close: () => {
        rl.close();
      },
    };
  },
  now: () => new Date().toISOString(),
  nlu: () => createNluServices(process.env),
};

process.exitCode = await runProgram(deps, process.argv, process.env["KUBRI_BOT_DEBUG"] === "1");
