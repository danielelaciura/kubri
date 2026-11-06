import type { Logger } from "pino";
import type { ChannelAdapter, OutboundSender, SendOutcome } from "../channels/channel";
import { findContactAddress, findLastInboundAt } from "../store/contacts";
import type { Database } from "../store/db";
import {
  claimNextOutbound,
  finishSend,
  type ClaimedMessage,
  type SendKey,
} from "../store/messages";
import type { JobQueue } from "../store/queue";
import { findOutboundSender } from "../store/senders";
import type { RuntimeConfig } from "./config";
import { withDeadline } from "./deadline";
import { reportOutboundFailure } from "./outbound-failure";

export interface SendDeps {
  readonly db: Database;
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  readonly queue: JobQueue;
  readonly channelFor: (provider: OutboundSender["provider"]) => ChannelAdapter;
  readonly now: () => Date;
}

/** Thrown to make pg-boss retry the job with its backoff (D108). */
export class TransientSendError extends Error {
  constructor(readonly code: string) {
    super(`transient send failure: ${code}`);
    this.name = "TransientSendError";
  }
}

/** D119: the window is checked before the call, so a call bound to fail is not made. */
async function windowClosed(
  deps: SendDeps,
  channel: ChannelAdapter,
  message: ClaimedMessage,
): Promise<boolean> {
  if (channel.freeFormWindowMs === null) return false;
  const last = await findLastInboundAt(deps.db, message.contactId, message.senderNumberId);
  return last === null || deps.now().getTime() - last.getTime() > channel.freeFormWindowMs;
}

async function sendOnce(deps: SendDeps, message: ClaimedMessage): Promise<SendOutcome> {
  const [to, sender] = await Promise.all([
    findContactAddress(deps.db, message.contactId),
    findOutboundSender(deps.db, message.senderNumberId),
  ]);
  const channel = deps.channelFor(sender.provider);
  if (await windowClosed(deps, channel, message)) {
    return { ok: false, kind: "permanent", code: "outside_window" };
  }
  try {
    const call = Promise.resolve().then(() =>
      channel.send({
        clientMessageId: message.id,
        sender,
        to: { externalId: to.externalId, phoneE164: to.phoneE164 },
        text: message.body,
        // D115: a channel without widgets gets the text alone.
        ...(message.interactive && channel.supportsInteractive
          ? { choices: message.interactive }
          : {}),
        // R8: the file was uploaded before the message was queued; the body is its caption.
        ...(message.document
          ? {
              document: { mediaId: message.document.mediaRef, filename: message.document.filename },
            }
          : {}),
      }),
    );
    // Shorter than the lease: the outcome is written while this sender still holds the claim.
    const result = await withDeadline(call, deps.config.sendCallTimeoutMs);
    // The message may have gone out anyway: it is sent again (at least once, D108).
    if (result.timedOut) return { ok: false, kind: "transient", code: "channel_timeout" };
    return result.value;
  } catch {
    // An adapter that throws is a broken connection, not a verdict on the message.
    return { ok: false, kind: "transient", code: "channel_exception" };
  }
}

/**
 * Sends a contact's queued messages in order, until none is left, one is in someone else's
 * hands, or one fails (D108). Safe to run twice at once: the claim serializes the senders, and
 * a sender that lost its claim (lease expired) writes nothing and reports nothing.
 */
export async function sendMessages(deps: SendDeps, key: SendKey): Promise<void> {
  for (;;) {
    const claim = await claimNextOutbound(deps.db, key, deps.now(), deps.config.sendLeaseMs);
    if (claim === null) return;
    if (claim === "busy") {
      // The holder keeps going; this is only a safety net if it died before finishing.
      await deps.queue.enqueue("send-messages", key, {
        startAfterSeconds: Math.ceil(deps.config.sendLeaseMs / 1000),
      });
      return;
    }
    const outcome = await sendOnce(deps, claim);
    const ids = { messageId: claim.id, sessionId: claim.sessionId, turnId: claim.turnId };
    if (outcome.ok) {
      const finished = await finishSend(deps.db, claim, {
        kind: "sent",
        providerMessageId: outcome.providerMessageId,
        at: deps.now(),
      });
      if (finished === "lost_claim") {
        lostClaim(deps, ids);
        return;
      }
      continue;
    }
    if (outcome.kind === "transient" && claim.attempts < deps.config.sendMaxAttempts) {
      const finished = await finishSend(deps.db, claim, { kind: "transient", code: outcome.code });
      if (finished === "lost_claim") {
        lostClaim(deps, ids);
        return;
      }
      deps.logger.info({ ...ids, code: outcome.code, attempt: claim.attempts }, "send retried");
      throw new TransientSendError(outcome.code);
    }
    const code = outcome.kind === "transient" ? "too_many_attempts" : outcome.code;
    const finished = await finishSend(deps.db, claim, { kind: "permanent", code, at: deps.now() });
    if (finished === "lost_claim") {
      lostClaim(deps, ids);
      return;
    }
    deps.logger.warn({ ...ids, code }, "message failed for good");
    await reportOutboundFailure(deps, claim);
    return;
  }
}

/** Another sender owns the message now: its outcome is the one that counts. */
function lostClaim(deps: SendDeps, ids: Record<string, string | null>): void {
  deps.logger.warn(ids, "send claim lost: outcome not written");
}
