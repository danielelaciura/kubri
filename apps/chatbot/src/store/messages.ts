import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import type { Database, Tx } from "./db";
import { lockKey } from "./db";
import { asJson } from "./json";

export type MessageKind =
  "text" | "audio" | "image" | "document" | "interactive" | "location" | "unsupported";

/** The choices sent with an interactive message, titles already resolved and cut (D115, D116). */
export interface StoredChoices {
  readonly listButton: string;
  readonly options: readonly { readonly id: string; readonly title: string }[];
}

const StoredChoicesSchema = z.strictObject({
  listButton: z.string(),
  options: z.array(z.strictObject({ id: z.string(), title: z.string() })),
});

/** The provider's raw payload, as JSON. Exported so the runtime never imports Prisma types. */
export type PayloadRaw = Prisma.InputJsonValue;

export interface InboundMessageInput {
  readonly contactId: string;
  readonly senderNumberId: string;
  readonly providerMessageId: string;
  readonly type: MessageKind;
  readonly body: string | null;
  /** The id of the button or list row tapped (D116). */
  readonly replyId?: string | null;
  readonly payloadRaw: PayloadRaw;
}

/** `ON CONFLICT DO NOTHING` on the provider id: a duplicate neither fails nor aborts the transaction. */
export async function insertInboundMessage(
  tx: Tx,
  input: InboundMessageInput,
): Promise<{ created: boolean }> {
  const result = await tx.message.createMany({
    data: [{ ...input, direction: "inbound", status: "received" }],
    skipDuplicates: true,
  });
  return { created: result.count === 1 };
}

export interface BurstMessage {
  readonly id: string;
  readonly type: MessageKind;
  readonly body: string | null;
  readonly replyId: string | null;
  readonly createdAt: Date;
}

/** The unprocessed inbound messages of a contact on a number, oldest first (spec §11.2). */
export function receivedBurst(
  tx: Tx,
  contactId: string,
  senderNumberId: string,
): Promise<BurstMessage[]> {
  return tx.message.findMany({
    where: { contactId, senderNumberId, direction: "inbound", status: "received" },
    orderBy: { ordinal: "asc" },
    select: { id: true, type: true, body: true, replyId: true, createdAt: true },
  });
}

export interface ProcessedInbound {
  readonly id: string;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  readonly bodyRedacted: string | null;
}

export async function markInboundProcessed(
  tx: Tx,
  messages: readonly ProcessedInbound[],
): Promise<void> {
  for (const m of messages) {
    await tx.message.update({
      where: { id: m.id },
      data: {
        status: "processed",
        sessionId: m.sessionId,
        turnId: m.turnId,
        bodyRedacted: m.bodyRedacted,
      },
    });
  }
}

/** The last `limit` redacted candidate messages of the session, oldest first (D107). */
export async function recentRedactedHistory(
  tx: Tx,
  sessionId: string,
  limit: number,
): Promise<string[]> {
  if (limit === 0) return [];
  const rows = await tx.message.findMany({
    where: { sessionId, direction: "inbound", type: "text", bodyRedacted: { not: null } },
    orderBy: { ordinal: "desc" },
    take: limit,
    select: { bodyRedacted: true },
  });
  return rows.reverse().flatMap((row) => (row.bodyRedacted === null ? [] : [row.bodyRedacted]));
}

export interface OutboundMessageInput {
  readonly contactId: string;
  readonly senderNumberId: string;
  readonly sessionId: string;
  readonly turnId: string | null;
  readonly body: string;
  readonly language: string;
  readonly stepId: string | null;
  readonly questionId: string | null;
  /** The widget sent with the text (D116); absent or null for plain text. */
  readonly interactive?: StoredChoices | null;
}

/** One insert at a time: the sequence number must follow the engine's order. */
export async function queueOutbound(
  tx: Tx,
  messages: readonly OutboundMessageInput[],
): Promise<void> {
  for (const { interactive, ...m } of messages) {
    await tx.message.create({
      data: {
        ...m,
        direction: "outbound",
        type: interactive ? "interactive" : "text",
        status: "queued",
        ...(interactive ? { interactive: asJson(interactive) } : {}),
      },
    });
  }
}

export interface SendKey {
  readonly contactId: string;
  readonly senderNumberId: string;
}

export interface ClaimedMessage {
  readonly id: string;
  readonly contactId: string;
  readonly senderNumberId: string;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  readonly body: string;
  /** The widget to send with the body, if any (D116). */
  readonly interactive: StoredChoices | null;
  readonly attempts: number;
}

function parseChoices(json: unknown): StoredChoices | null {
  const parsed = StoredChoicesSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * D108: the next queued message of a contact on a number, or "busy" when another sender holds
 * a live claim, or null when nothing is left. The advisory lock makes the check-and-claim atomic;
 * the lease frees a message whose sender crashed. Queued messages with an empty body are
 * failed (`empty_body`) on the way.
 */
export async function claimNextOutbound(
  db: Database,
  key: SendKey,
  now: Date,
  leaseMs: number,
): Promise<ClaimedMessage | "busy" | null> {
  return db.$transaction(async (tx) => {
    await lockKey(tx, `send:${key.contactId}:${key.senderNumberId}`);
    const where = { ...key, direction: "outbound" as const };
    await tx.message.updateMany({
      where: { ...where, status: "sending", leaseUntil: { lt: now } },
      data: { status: "queued", leaseUntil: null },
    });
    const live = await tx.message.count({ where: { ...where, status: "sending" } });
    if (live > 0) return "busy";
    // An empty body can never be sent: it fails on its own instead of blocking the queue.
    await tx.message.updateMany({
      where: { ...where, status: "queued", OR: [{ body: null }, { body: "" }] },
      data: { status: "failed", failedAt: now, errorCode: "empty_body" },
    });
    const next = await tx.message.findFirst({
      where: { ...where, status: "queued" },
      orderBy: { ordinal: "asc" },
    });
    if (!next || next.body === null) return null;
    const claimed = await tx.message.update({
      where: { id: next.id },
      data: {
        status: "sending",
        attempts: { increment: 1 },
        leaseUntil: new Date(now.getTime() + leaseMs),
      },
    });
    return {
      id: claimed.id,
      contactId: claimed.contactId,
      senderNumberId: claimed.senderNumberId,
      sessionId: claimed.sessionId,
      turnId: claimed.turnId,
      body: next.body,
      interactive: parseChoices(claimed.interactive),
      attempts: claimed.attempts,
    };
  });
}

export type SendResult =
  | { readonly kind: "sent"; readonly providerMessageId: string; readonly at: Date }
  | { readonly kind: "transient"; readonly code: string }
  | { readonly kind: "permanent"; readonly code: string; readonly at: Date };

/** "lost_claim": the lease expired and another sender took the message; nothing was written. */
export type FinishOutcome = "applied" | "lost_claim";

/**
 * Writes the result only while this sender still holds the claim: the row is still `sending`
 * with the attempt number it was claimed with. A late result from an expired claim would
 * otherwise overwrite the new claimer's outcome (or fail the rest of a turn already sent).
 */
export async function finishSend(
  db: Database,
  message: ClaimedMessage,
  result: SendResult,
): Promise<FinishOutcome> {
  return db.$transaction(async (tx) => {
    const claim = { id: message.id, status: "sending" as const, attempts: message.attempts };
    switch (result.kind) {
      case "sent": {
        const { count } = await tx.message.updateMany({
          where: claim,
          data: {
            status: "sent",
            providerMessageId: result.providerMessageId,
            sentAt: result.at,
            leaseUntil: null,
            errorCode: null,
          },
        });
        return count === 1 ? "applied" : "lost_claim";
      }
      case "transient": {
        const { count } = await tx.message.updateMany({
          where: claim,
          data: { status: "queued", leaseUntil: null, errorCode: result.code },
        });
        return count === 1 ? "applied" : "lost_claim";
      }
      case "permanent": {
        const { count } = await tx.message.updateMany({
          where: claim,
          data: { status: "failed", failedAt: result.at, leaseUntil: null, errorCode: result.code },
        });
        if (count === 0) return "lost_claim";
        if (message.turnId !== null) {
          // Spec §11.3: the rest of the turn is not sent after a definitive error.
          await tx.message.updateMany({
            where: { turnId: message.turnId, direction: "outbound", status: "queued" },
            data: { status: "failed", failedAt: result.at, errorCode: "skipped_after_failure" },
          });
        }
        return "applied";
      }
    }
  });
}

/** The provider id of the newest unprocessed inbound message: what the read receipt names. */
export async function latestReceivedProviderId(
  tx: Tx,
  contactId: string,
  senderNumberId: string,
): Promise<string | null> {
  const row = await tx.message.findFirst({
    where: {
      contactId,
      senderNumberId,
      direction: "inbound",
      status: "received",
      providerMessageId: { not: null },
    },
    orderBy: { ordinal: "desc" },
    select: { providerMessageId: true },
  });
  return row?.providerMessageId ?? null;
}

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

/** D120: a status moves a message forward only. `sent` is already known when the id is. */
const MOVES_FROM: Readonly<Record<DeliveryStatus, readonly ("sent" | "delivered")[]>> = {
  sent: [],
  delivered: ["sent"],
  read: ["sent", "delivered"],
  failed: ["sent", "delivered"],
};

export interface DeliveryUpdate {
  readonly providerMessageId: string;
  readonly status: DeliveryStatus;
  readonly at: Date;
  /** The classified error code, for `failed`. */
  readonly errorCode: string | null;
}

export interface DeliveryResult {
  /** The status moved the message forward. */
  readonly updated: boolean;
  /** null when no outbound message has this provider id (yet). */
  readonly contactId: string | null;
  readonly sessionId: string | null;
  readonly turnId: string | null;
}

export async function applyDeliveryStatus(tx: Tx, update: DeliveryUpdate): Promise<DeliveryResult> {
  const from = MOVES_FROM[update.status];
  const data =
    update.status === "failed"
      ? { status: "failed" as const, failedAt: update.at, errorCode: update.errorCode }
      : update.status === "read"
        ? { status: "read" as const, readAt: update.at }
        : { status: "delivered" as const, deliveredAt: update.at };
  const result =
    from.length === 0
      ? { count: 0 }
      : await tx.message.updateMany({
          where: {
            providerMessageId: update.providerMessageId,
            direction: "outbound",
            status: { in: [...from] },
          },
          data,
        });
  const row = await tx.message.findFirst({
    where: { providerMessageId: update.providerMessageId, direction: "outbound" },
    select: { contactId: true, sessionId: true, turnId: true },
  });
  return {
    updated: result.count === 1,
    contactId: row?.contactId ?? null,
    sessionId: row?.sessionId ?? null,
    turnId: row?.turnId ?? null,
  };
}
