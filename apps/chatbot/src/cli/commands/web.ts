import type { Command } from "commander";
import { parseEnv } from "../../config/env";
import { parseWebConfig } from "../../ingress/config";
import { createWebhookServer } from "../../ingress/server";
import { createLogger } from "../../observability/logger";
import { parseRuntimeConfig } from "../../runtime/config";
import { workerQueueSettings } from "../../runtime/worker";
import { createQueueRuntime } from "../../store/queue";
import { CliError, type CliDeps } from "../deps";
import { untilStopped } from "../until-stopped";

/** Configuration problems are explained in one line, before any connection is opened. */
function readConfig() {
  try {
    const env = parseEnv(process.env);
    const config = parseRuntimeConfig(process.env);
    const web = parseWebConfig(process.env);
    const logger = createLogger({ level: env.LOG_LEVEL });
    // The worker's settings (plan 08): QUEUE_DATABASE_URL, never DATABASE_URL in production,
    // and the same retry limits. start() re-applies the queues' options, so other settings
    // here would reset the worker's send-messages retries.
    const queueSettings = workerQueueSettings(config, logger);
    return { env, config, web, logger, queueSettings };
  } catch (error: unknown) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

export function registerWebCommands(program: Command, deps: CliDeps): void {
  program
    .command("web")
    .description("Run the web process (WhatsApp webhooks)")
    .command("start")
    .description("Listen on PORT for Meta's webhook: GET/POST /webhooks/whatsapp, GET /health")
    .action(async () => {
      const { env, config, web, logger, queueSettings } = readConfig();
      await deps.withDatabase(async (db) => {
        const queue = createQueueRuntime(queueSettings);
        await queue.start();
        try {
          const server = createWebhookServer({
            db,
            queue: queue.queue,
            config,
            logger,
            appSecret: web.appSecret,
            verifyToken: web.verifyToken,
            now: () => new Date(),
          });
          await new Promise<void>((resolve) => {
            server.listen(env.PORT, resolve);
          });
          deps.out(`web listening on :${String(env.PORT)} (POST /webhooks/whatsapp)`);
          await untilStopped();
          await new Promise<void>((resolve) => {
            server.close(() => {
              resolve();
            });
          });
        } finally {
          await queue.stop();
        }
      });
      deps.out("web stopped");
    });
}
