import { registerInbound, upsertContact } from "../store/contacts";
import { inTransaction, type Database } from "../store/db";
import { insertInboundMessage, type MessageKind, type PayloadRaw } from "../store/messages";
import type { JobQueue } from "../store/queue";
import type { RuntimeConfig } from "./config";

/** A message from a person, already parsed by a channel (plan 09). */
export interface InboundMessage {
  readonly senderNumberId: string;
  readonly providerMessageId: string;
  readonly from: { readonly externalId: string; readonly phoneE164: string };
  readonly type: MessageKind;
  readonly body: string | null;
  readonly receivedAt: Date;
  readonly payloadRaw: PayloadRaw;
}

export interface ReceiveDeps {
  readonly db: Database;
  readonly queue: JobQueue;
  readonly config: Pick<RuntimeConfig, "debounceMs">;
}

const RECEIVE_TIMEOUT_MS = 15_000;

/**
 * Spec §11.1 in one transaction: the contact, the message (deduplicated on the provider id),
 * the 24 hour window, and the `process-contact` job, delayed by the quiet time (D106).
 * Nothing here waits for the NLU. The redacted copy is written by the turn, which has the
 * interpretation it needs (D107): until then the message is only `received`.
 */
export async function receiveInbound(
  deps: ReceiveDeps,
  message: InboundMessage,
): Promise<{ duplicate: boolean }> {
  return inTransaction(
    deps.db,
    async (tx) => {
      const contact = await upsertContact(tx, {
        channel: "whatsapp",
        externalId: message.from.externalId,
        phoneE164: message.from.phoneE164,
      });
      const { created } = await insertInboundMessage(tx, {
        contactId: contact.id,
        senderNumberId: message.senderNumberId,
        providerMessageId: message.providerMessageId,
        type: message.type,
        body: message.body,
        payloadRaw: message.payloadRaw,
      });
      if (!created) return { duplicate: true };
      await registerInbound(tx, {
        contactId: contact.id,
        senderNumberId: message.senderNumberId,
        at: message.receivedAt,
      });
      const delaySeconds = Math.ceil(deps.config.debounceMs / 1000);
      await deps.queue.enqueue(
        "process-contact",
        { contactId: contact.id, senderNumberId: message.senderNumberId },
        delaySeconds > 0 ? { startAfterSeconds: delaySeconds } : {},
        tx,
      );
      return { duplicate: false };
    },
    RECEIVE_TIMEOUT_MS,
  );
}
