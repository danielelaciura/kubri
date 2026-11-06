import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import { parseEnv } from "../../config/env";
import { createLogger } from "../../observability/logger";
import { parseRuntimeConfig, type RuntimeConfig } from "../../runtime/config";
import { receiveInbound } from "../../runtime/receive";
import { workerQueueSettings } from "../../runtime/worker";
import { createQueueRuntime, type QueueSettings } from "../../store/queue";
import { findSenderNumberBySlug } from "../../store/senders";
import { CliError, type CliDeps } from "../deps";

const E164 = /^\+[1-9]\d{6,14}$/;

export function registerInboundCommands(program: Command, deps: CliDeps): void {
  const inbound = program
    .command("inbound")
    .description("Simulate a candidate writing to a number");

  inbound
    .command("send")
    .description("Store a text message as if it came from WhatsApp; a running worker answers it")
    .argument("<text...>", "the message")
    .requiredOption("--sender <slug>", "the sender number (SenderNumber.slug)")
    .requiredOption("--from <e164>", "the candidate's phone number, e.g. +393331112233")
    .action(async (words: string[], options: { sender: string; from: string }) => {
      if (!E164.test(options.from)) throw new CliError("--from must be an E.164 number");
      let config: RuntimeConfig;
      let queueSettings: QueueSettings;
      try {
        config = parseRuntimeConfig(process.env);
        // The worker's settings: starting pg-boss re-applies the queues' options (retries).
        const logger = createLogger({ level: parseEnv(process.env).LOG_LEVEL });
        queueSettings = workerQueueSettings(config, logger);
      } catch (error: unknown) {
        throw new CliError(error instanceof Error ? error.message : String(error));
      }
      await deps.withDatabase(async (db) => {
        const sender = await findSenderNumberBySlug(db, options.sender);
        if (!sender) throw new CliError(`Unknown sender "${options.sender}"`);
        const queue = createQueueRuntime(queueSettings);
        await queue.start();
        try {
          const result = await receiveInbound(
            { db, queue: queue.queue, config },
            {
              senderNumberId: sender.id,
              providerMessageId: `cli-${randomUUID()}`,
              from: { externalId: options.from.slice(1), phoneE164: options.from },
              type: "text",
              body: words.join(" "),
              receivedAt: new Date(),
              payloadRaw: { source: "cli" },
            },
          );
          deps.out(result.duplicate ? "duplicate, ignored" : "queued");
        } finally {
          await queue.stop();
        }
      });
    });
}
