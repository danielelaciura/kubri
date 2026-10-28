import type { Prisma } from "../generated/prisma/client";
import type { Database, Tx } from "./db";
import { lockKey } from "./db";

export type MessageKind = "text" | "audio" | "image" | "document" | "location" | "unsupported";

/** The provider's raw payload, as JSON. Exported so the runtime never imports Prisma types. */
export type PayloadRaw = Prisma.InputJsonValue;

export interface InboundMessageInput {
  readonly contactId: string;
  readonly senderNumberId: string;
  readonly providerMessageId: string;
  readonly type: MessageKind;
  readonly body: string | null;
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
    select: { id: true, type: true, body: true, createdAt: true },
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
}

/** One insert at a time: the sequence number must follow the engine's order. */
export async function queueOutbound(
  tx: Tx,
  messages: readonly OutboundMessageInput[],
): Promise<void> {
  for (const m of messages) {
    await tx.message.create({
      data: { ...m, direction: "outbound", type: "text", status: "queued" },
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
  readonly attempts: number;
}

/**
 * D108: the next queued message of a contact on a number, or "busy" when another sender holds
 * a live claim, or null when nothing is left. The advisory lock makes the check-and-claim atomic;
 * the lease frees a message whose sender crashed.
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
      attempts: claimed.attempts,
    };
  });
}

export type SendResult =
  | { readonly kind: "sent"; readonly providerMessageId: string; readonly at: Date }
  | { readonly kind: "transient"; readonly code: string }
  | { readonly kind: "permanent"; readonly code: string; readonly at: Date };

export async function finishSend(
  db: Database,
  message: ClaimedMessage,
  result: SendResult,
): Promise<void> {
  await db.$transaction(async (tx) => {
    switch (result.kind) {
      case "sent":
        await tx.message.update({
          where: { id: message.id },
          data: {
            status: "sent",
            providerMessageId: result.providerMessageId,
            sentAt: result.at,
            leaseUntil: null,
            errorCode: null,
          },
        });
        return;
      case "transient":
        await tx.message.update({
          where: { id: message.id },
          data: { status: "queued", leaseUntil: null, errorCode: result.code },
        });
        return;
      case "permanent":
        await tx.message.update({
          where: { id: message.id },
          data: { status: "failed", failedAt: result.at, leaseUntil: null, errorCode: result.code },
        });
        if (message.turnId !== null) {
          // Spec §11.3: the rest of the turn is not sent after a definitive error.
          await tx.message.updateMany({
            where: { turnId: message.turnId, direction: "outbound", status: "queued" },
            data: { status: "failed", failedAt: result.at, errorCode: "skipped_after_failure" },
          });
        }
        return;
    }
  });
}
