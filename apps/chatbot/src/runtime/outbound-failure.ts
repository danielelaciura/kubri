import type { Logger } from "pino";
import type { Effect } from "../engine/effects";
import { initialSessionState, type SessionState } from "../engine/state";
import { findCampaignVersion } from "../store/campaigns";
import type { Database } from "../store/db";
import { inTransaction, lockKey } from "../store/db";
import { findSessionById } from "../store/sessions";
import { recordFlag } from "./apply-effects";
import { reportFailureTransactionMs, type RuntimeConfig } from "./config";
import { stepSafely } from "./safe";
import { decodeState } from "./state-codec";

export interface FailureDeps {
  readonly db: Database;
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  readonly now: () => Date;
}

/** The message that could not be delivered: who it was for and which turn sent it. */
export interface FailedOutbound {
  readonly contactId: string;
  readonly sessionId: string | null;
  readonly turnId: string | null;
}

const OUTBOUND_FAILED_FLAG: Effect = {
  type: "FlagSession",
  reason: "outbound_failed",
  needsAttention: true,
};

/**
 * Spec §11.3, D120: after a definitive error — at send time or in a later delivery status (the
 * `report-failure` job) — the engine hears about it (`outbound_failed`), which flags the
 * session. Only the flags are applied, and the state is never saved here: the reply to the
 * candidate is the one that could not be sent. The contact's lock serializes this with a
 * running turn, whose saveSession would otherwise write back the status it read before.
 */
export async function reportOutboundFailure(
  deps: FailureDeps,
  message: FailedOutbound,
): Promise<void> {
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
    reportFailureTransactionMs(deps.config),
  );
}
