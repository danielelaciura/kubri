import { Option, type Command } from "commander";
import { ConsoleChannel } from "../../channels/channel";
import { createMetaCloudChannel } from "../../channels/meta-cloud/client";
import { parseEnv } from "../../config/env";
import { FakeTranslator } from "../../i18n/fake-translator";
import { parseGraphVersion } from "../../ingress/config";
import { readKubriConfig, type KubriConfig } from "../../integrations/config";
import { createKubriClient } from "../../integrations/kubri/client";
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
import { untilStopped } from "../until-stopped";
import { naiveInterpreter } from "../simulate/naive-interpreter";
import {
  INTERPRETER_KINDS,
  TRANSLATOR_KINDS,
  type InterpreterKind,
  type TranslatorKind,
} from "../simulate/services";

const CHANNEL_KINDS = ["console", "meta"] as const;
type ChannelKind = (typeof CHANNEL_KINDS)[number];

interface WorkerOptions {
  readonly nlu: InterpreterKind;
  readonly translator: TranslatorKind;
  readonly channel: ChannelKind;
}

/** C9: in production the worker never prints replies, nor fakes the NLU or the translations. */
function fakesInProduction(options: WorkerOptions): string[] {
  return [
    ...(options.channel === "console" ? ["--channel console"] : []),
    ...(options.nlu === "naive" ? ["--nlu naive"] : []),
    ...(options.translator === "fake" ? ["--translator fake"] : []),
  ];
}

/**
 * R9: the Kubri dashboard is optional only outside production. Without it, development
 * workers dead-letter kubri-webhook jobs (`not_configured`); half a configuration is an error.
 */
function kubriConfig(nodeEnv: string | undefined): KubriConfig | null {
  const kubri = readKubriConfig(process.env);
  if (kubri === null && nodeEnv === "production") {
    throw new Error(
      "KUBRI_BASE_URL and CHATBOT_WEBHOOK_SECRET are not set: the worker sends candidates to the Kubri dashboard.",
    );
  }
  return kubri;
}

/** Configuration problems are explained in one line, before any connection is opened. */
function readConfig(options: WorkerOptions) {
  try {
    const env = parseEnv(process.env);
    if (env.NODE_ENV === "production") {
      const fakes = fakesInProduction(options);
      if (fakes.length > 0) {
        throw new Error(
          `${fakes.join(", ")} cannot run in production: use --channel meta --nlu llm --translator llm.`,
        );
      }
    }
    const config = parseRuntimeConfig(process.env);
    const consentHashSecret = requireConsentHashSecret(config);
    const graphVersion = options.channel === "meta" ? parseGraphVersion(process.env) : null;
    const logger = createLogger({ level: env.LOG_LEVEL });
    const queueSettings = workerQueueSettings(config, logger);
    const kubri = kubriConfig(env.NODE_ENV);
    return { config, consentHashSecret, logger, queueSettings, graphVersion, kubri };
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
      "Process inbound messages and send the replies (printed here with --channel console)",
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
    .addOption(
      new Option("--channel <kind>", "where replies go: the terminal, or WhatsApp")
        .choices(CHANNEL_KINDS)
        .default("console"),
    )
    .action(async (options: WorkerOptions) => {
      const { config, consentHashSecret, logger, queueSettings, graphVersion, kubri } =
        readConfig(options);
      if (kubri === null) {
        logger.warn("Kubri is not configured: kubri-webhook jobs go to the dead letter queue");
      }
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
          const channel =
            graphVersion !== null
              ? createMetaCloudChannel({
                  graphVersion,
                  // The token is the value of the variable NAMED in the number's configuration.
                  secret: (name) => process.env[name],
                })
              : new ConsoleChannel(deps.out);
          const now = () => new Date();
          try {
            await startWorker({
              queue,
              kubri: kubri ? createKubriClient(kubri) : null,
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
                channelFor: () => channel,
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
