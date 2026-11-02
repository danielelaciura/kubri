import type { Logger } from "pino";
import { parseWebhook, type ParsedMessage } from "../channels/meta-cloud/parse";
import { verifyChallenge, verifySignature } from "../channels/meta-cloud/signature";
import { handleStatusUpdate } from "../runtime/delivery";
import { receiveInbound } from "../runtime/receive";
import type { RuntimeConfig } from "../runtime/config";
import type { Database } from "../store/db";
import { insertDeadLetter } from "../store/dead-letters";
import type { PayloadRaw } from "../store/messages";
import type { JobQueue } from "../store/queue";
import { findSenderByPhoneNumberId } from "../store/senders";

export interface WebhookDeps {
  readonly db: Database;
  readonly queue: JobQueue;
  readonly config: Pick<RuntimeConfig, "debounceMs">;
  readonly logger: Logger;
  /** Meta's app secret: signs every POST. */
  readonly appSecret: string;
  /** The token chosen when the webhook was set up in Meta's console. */
  readonly verifyToken: string;
  readonly now: () => Date;
}

export interface HttpReply {
  readonly status: number;
  readonly body: string;
}

const OK: HttpReply = { status: 200, body: "ok" };
const MAX_RAW_TEXT = 10_000;

/** JSON that came from JSON.parse is already valid JSON: this only tells the type system. */
const asJson = (value: unknown): PayloadRaw => value as PayloadRaw;

/** GET: Meta checks the webhook once, when it is saved in the console. */
export function handleVerification(deps: WebhookDeps, query: URLSearchParams): HttpReply {
  const challenge = verifyChallenge(query, deps.verifyToken);
  return challenge === null ? { status: 403, body: "forbidden" } : { status: 200, body: challenge };
}

async function deadLetter(deps: WebhookDeps, raw: unknown, reason: string): Promise<void> {
  await insertDeadLetter(deps.db, { raw: asJson(raw), reason });
  deps.logger.warn({ reason }, "webhook item kept as a dead letter");
}

async function storeMessage(deps: WebhookDeps, message: ParsedMessage): Promise<void> {
  const sender = await findSenderByPhoneNumberId(deps.db, message.phoneNumberId);
  if (!sender) {
    await deadLetter(deps, message.raw, "unknown_sender");
    return;
  }
  await receiveInbound(
    { db: deps.db, queue: deps.queue, config: deps.config },
    {
      senderNumberId: sender.id,
      providerMessageId: message.providerMessageId,
      from: message.from,
      type: message.type,
      body: message.body,
      reply: message.reply,
      receivedAt: message.receivedAt,
      payloadRaw: asJson(message.raw),
    },
  );
}

/**
 * POST (D117): signature, parsing, storage and the turn's job, nothing slow. A failure of ours
 * (the database) throws: the server answers 500 and Meta tries again, which deduplication
 * makes safe. What is not ours to fix is kept as a dead letter and answered with 200.
 */
export async function handleWebhook(
  deps: WebhookDeps,
  rawBody: Buffer,
  signature: string | undefined,
): Promise<HttpReply> {
  if (!verifySignature(deps.appSecret, rawBody, signature)) {
    deps.logger.warn("webhook signature rejected");
    return { status: 401, body: "invalid signature" };
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString("utf8"));
  } catch {
    await deadLetter(
      deps,
      { text: rawBody.toString("utf8").slice(0, MAX_RAW_TEXT) },
      "invalid_json",
    );
    return OK;
  }
  const parsed = parseWebhook(json);
  if (!parsed) {
    await deadLetter(deps, json, "not_whatsapp");
    return OK;
  }
  for (const item of parsed.rejected) await deadLetter(deps, item, "unreadable_item");
  for (const message of parsed.messages) await storeMessage(deps, message);
  for (const status of parsed.statuses) {
    await handleStatusUpdate(deps, {
      providerMessageId: status.providerMessageId,
      status: status.status,
      at: status.at,
      errorCode: status.errorCode,
    });
  }
  deps.logger.info(
    { messages: parsed.messages.length, statuses: parsed.statuses.length, ignored: parsed.ignored },
    "webhook handled",
  );
  return OK;
}
