import type { Logger } from "pino";
import type { Database } from "../store/db";
import { inTransaction } from "../store/db";
import { insertDeadLetter } from "../store/dead-letters";
import { applyDeliveryStatus, type DeliveryStatus } from "../store/messages";
import type { JobQueue } from "../store/queue";

export interface DeliveryDeps {
  readonly db: Database;
  readonly queue: JobQueue;
  readonly logger: Logger;
  readonly now: () => Date;
}

export interface StatusUpdate {
  readonly providerMessageId: string;
  readonly status: DeliveryStatus;
  readonly at: Date;
  /** The classified error code (errorName in channels/meta-cloud/errors.ts), for a failure. */
  readonly errorCode: string | null;
}

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * D120: a delivery status from the provider moves the message forward. A message that failed
 * after it was sent gets a `report-failure` job, queued in the same transaction (C7): the
 * session is flagged by the worker under the contact's lock, never inside the webhook's
 * request, which must not wait for a turn. A failure for a message not known yet (the status
 * came before finishSend wrote the id) is kept as a dead letter; other statuses of unknown
 * messages, and backward moves, are ignored.
 */
export async function handleStatusUpdate(deps: DeliveryDeps, update: StatusUpdate): Promise<void> {
  await inTransaction(
    deps.db,
    async (tx) => {
      const result = await applyDeliveryStatus(tx, update);
      if (update.status !== "failed") return;
      if (result.contactId === null) {
        await insertDeadLetter(tx, {
          raw: {
            providerMessageId: update.providerMessageId,
            status: update.status,
            at: update.at.toISOString(),
            errorCode: update.errorCode,
          },
          reason: "status_unknown_message",
        });
        deps.logger.warn({ reason: "status_unknown_message" }, "delivery status dead-lettered");
        return;
      }
      if (!result.updated) return;
      deps.logger.warn(
        {
          contactId: result.contactId,
          sessionId: result.sessionId,
          turnId: result.turnId,
          code: update.errorCode,
        },
        "delivery failed",
      );
      if (result.sessionId === null) return;
      await deps.queue.enqueue(
        "report-failure",
        { contactId: result.contactId, sessionId: result.sessionId, turnId: result.turnId },
        {},
        tx,
      );
    },
    DELIVERY_TIMEOUT_MS,
  );
}
