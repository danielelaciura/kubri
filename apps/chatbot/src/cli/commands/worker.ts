import { Option, type Command } from "commander";
import { ConsoleChannel } from "../../channels/channel";
import { parseEnv } from "../../config/env";
import { FakeTranslator } from "../../i18n/fake-translator";
import { createTextResolver } from "../../i18n/resolve";
import type { Translator } from "../../i18n/translator";
import { REAL_TIMING } from "../../nlu/call-policy";
import { parseNluConfig } from "../../nlu/config";
import { createLlmInterpreter } from "../../nlu/interpret";
import type { Interpreter } from "../../nlu/interpreter";
import type { NluServices } from "../../nlu/services";
import type { NluTraceSink } from "../../nlu/trace";
import { createLlmTranslator } from "../../nlu/translate";
import { createLogger } from "../../observability/logger";
import { parseRuntimeConfig, requireConsentHashSecret, workerPoolSize } from "../../runtime/config";
import { startWorker, workerQueueSettings } from "../../runtime/worker";
import { createQueueRuntime } from "../../store/queue";
import { createDatabaseTraceSink, createDatabaseTranslationCache } from "../../store/traces";
import { CliError, type CliDeps } from "../deps";
import { naiveInterpreter } from "../simulate/naive-interpreter";
import {
  INTERPRETER_KINDS,
  TRANSLATOR_KINDS,
  type InterpreterKind,
  type TranslatorKind,
} from "../simulate/services";

interface WorkerOptions {
  readonly nlu: InterpreterKind;
  readonly translator: TranslatorKind;
}

/** Waits for Ctrl-C or a termination signal. */
function untilStopped(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

/** Configuration problems are explained in one line, before any connection is opened. */
function readConfig() {
  try {
    const env = parseEnv(process.env);
    const config = parseRuntimeConfig(process.env);
    const consentHashSecret = requireConsentHashSecret(config);
    const logger = createLogger({ level: env.LOG_LEVEL });
    const queueSettings = workerQueueSettings(config, logger);
    return { config, consentHashSecret, logger, queueSettings };
  } catch (error: unknown) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

function connectLlm(deps: CliDeps): NluServices {
  try {
    return deps.nlu();
  } catch (error: unknown) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

export function registerWorkerCommands(program: Command, deps: CliDeps): void {
  const worker = program
    .command("worker")
    .description("Run the worker (conversation turns and sending)");

  worker
    .command("start")
    .description(
      "Process inbound messages. Replies are printed here: no real channel yet (plan 09)",
    )
    .addOption(
      new Option("--nlu <kind>", "how answers are interpreted")
        .choices(INTERPRETER_KINDS)
        .default("naive"),
    )
    .addOption(
      new Option("--translator <kind>", "how texts are translated")
        .choices(TRANSLATOR_KINDS)
        .default("fake"),
    )
    .action(async (options: WorkerOptions) => {
      const { config, consentHashSecret, logger, queueSettings } = readConfig();
      // A missing MISTRAL_API_KEY stops here, before any connection.
      const llm = options.nlu === "llm" || options.translator === "llm" ? connectLlm(deps) : null;
      const nluConfig = llm?.config ?? parseNluConfig(process.env);
      await deps.withDatabase(
        async (db) => {
          const interpreterFor = (traces: NluTraceSink): Interpreter =>
            options.nlu === "llm" && llm
              ? createLlmInterpreter({ ...llm, traces, timing: REAL_TIMING, now: deps.now })
              : naiveInterpreter;
          // Translation traces have no turn: they go on their own connection (D102).
          const translator: Translator =
            options.translator === "llm" && llm
              ? createLlmTranslator({
                  ...llm,
                  traces: createDatabaseTraceSink(db),
                  timing: REAL_TIMING,
                  now: deps.now,
                })
              : new FakeTranslator();
          const queue = createQueueRuntime(queueSettings);
          const channel = new ConsoleChannel(deps.out);
          const now = () => new Date();
          try {
            await startWorker({
              queue,
              runtime: {
                db,
                config,
                logger,
                queue: queue.queue,
                resolver: createTextResolver({
                  translator,
                  cache: createDatabaseTranslationCache(db),
                }),
                interpreterFor,
                historyMessages: nluConfig.historyMessages,
                consentHashSecret,
                now,
              },
              send: { db, config, logger, queue: queue.queue, channelFor: () => channel, now },
            });
            deps.out("worker started: Ctrl-C to stop");
            await untilStopped();
          } finally {
            await queue.stop();
          }
          deps.out("worker stopped");
        },
        { poolSize: workerPoolSize(config) },
      );
    });
}
