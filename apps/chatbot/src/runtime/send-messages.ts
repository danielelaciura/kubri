import type { Logger } from "pino";
import type { ChannelAdapter, OutboundSender, SendOutcome } from "../channels/channel";
import type { Effect } from "../engine/effects";
import { initialSessionState, type SessionState } from "../engine/state";
import { findCampaignVersion } from "../store/campaigns";
import { findContactAddress } from "../store/contacts";
import type { Database } from "../store/db";
import { inTransaction, lockKey } from "../store/db";
import {
  claimNextOutbound,
  finishSend,
  type ClaimedMessage,
  type SendKey,
} from "../store/messages";
import type { JobQueue } from "../store/queue";
import { findOutboundSender } from "../store/senders";
import { findSessionById } from "../store/sessions";
import { recordFlag } from "./apply-effects";
import type { RuntimeConfig } from "./config";
import { withDeadline } from "./deadline";
import { stepSafely } from "./safe";
import { decodeState } from "./state-codec";

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

async function sendOnce(deps: SendDeps, message: ClaimedMessage): Promise<SendOutcome> {
  const [to, sender] = await Promise.all([
    findContactAddress(deps.db, message.contactId),
    findOutboundSender(deps.db, message.senderNumberId),
  ]);
  try {
    const call = Promise.resolve().then(() =>
      deps.channelFor(sender.provider).send({
        clientMessageId: message.id,
        sender,
        to: { externalId: to.externalId, phoneE164: to.phoneE164 },
        text: message.body,
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

const OUTBOUND_FAILED_FLAG: Effect = {
  type: "FlagSession",
  reason: "outbound_failed",
  needsAttention: true,
};

/**
 * Spec §11.3: after a definitive error the engine hears about it (`outbound_failed`), which
 * flags the session. Only the flags are applied, and the state is never saved here: the reply
 * to the candidate is the one that could not be sent. The contact's lock serializes this with
 * a running turn, whose saveSession would otherwise write back the status it read before.
 */
async function reportFailure(deps: SendDeps, message: ClaimedMessage): Promise<void> {
  if (message.sessionId === null) return;
  const sessionId = message.sessionId;
  await inTransaction(
    deps.db,
    async (tx) => {
      await lockKey(tx, `contact:${message.contactId}`);
      const session = await findSessionById(tx, sessionId);
      if (!session) return;
      const campaign = await findCampaignVersion(deps.db, session.campaignVersionId);
      let effects: readonly Effect[] = [OUTBOUND_FAILED_FLAG];
      if (campaign) {
        // outbound_failed does not read the state: an unreadable one must not hide the flag.
        let state: SessionState;
        try {
          state = decodeState(session.engineState, {});
        } catch {
          state = initialSessionState();
        }
        const event = { type: "outbound_failed", at: deps.now().toISOString() } as const;
        effects = stepSafely(state, event, campaign.definition, deps.logger).effects;
      }
      for (const effect of effects) {
        if (effect.type !== "FlagSession") continue;
        await recordFlag(tx, { sessionId, turnId: message.turnId, logger: deps.logger }, effect);
      }
    },
    // It may wait for a whole turn to release the contact's lock.
    deps.config.turnTransactionMs + 15_000,
  );
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
    await reportFailure(deps, claim);
    return;
  }
}

/** Another sender owns the message now: its outcome is the one that counts. */
function lostClaim(deps: SendDeps, ids: Record<string, string | null>): void {
  deps.logger.warn(ids, "send claim lost: outcome not written");
}
