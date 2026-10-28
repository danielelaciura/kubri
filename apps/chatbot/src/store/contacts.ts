import type { Tx } from "./db";

export interface ContactInput {
  readonly channel: "whatsapp";
  readonly externalId: string;
  readonly phoneE164: string;
}

export interface ContactRecord {
  readonly id: string;
  readonly preferredLanguage: string | null;
}

/** By (channel, externalId); the phone number follows the provider's latest value. */
export function upsertContact(tx: Tx, input: ContactInput): Promise<ContactRecord> {
  return tx.contact.upsert({
    where: { channel_externalId: { channel: input.channel, externalId: input.externalId } },
    create: { ...input },
    update: { phoneE164: input.phoneE164 },
    select: { id: true, preferredLanguage: true },
  });
}

export async function setPreferredLanguage(
  tx: Tx,
  contactId: string,
  language: string,
): Promise<void> {
  await tx.contact.update({ where: { id: contactId }, data: { preferredLanguage: language } });
}

export interface InboundSeen {
  readonly contactId: string;
  readonly senderNumberId: string;
  readonly at: Date;
}

/**
 * An inbound message opens the 24 hour window (spec §11.3) and brings an opted-out contact
 * back (D105): the closing text promises they can write again whenever they want.
 */
export async function registerInbound(tx: Tx, input: InboundSeen): Promise<void> {
  const where = {
    contactId_senderNumberId: { contactId: input.contactId, senderNumberId: input.senderNumberId },
  };
  await tx.contactChannelState.upsert({
    where,
    create: {
      contactId: input.contactId,
      senderNumberId: input.senderNumberId,
      lastInboundAt: input.at,
      optInSource: "inbound",
      optInAt: input.at,
    },
    update: { lastInboundAt: input.at },
  });
  await tx.contactChannelState.updateMany({
    where: {
      contactId: input.contactId,
      senderNumberId: input.senderNumberId,
      optInStatus: "opted_out",
    },
    data: { optInStatus: "opted_in", optInSource: "inbound", optInAt: input.at },
  });
}

export async function recordOptOut(
  tx: Tx,
  contactId: string,
  senderNumberId: string,
  at: Date,
): Promise<void> {
  await tx.contactChannelState.upsert({
    where: { contactId_senderNumberId: { contactId, senderNumberId } },
    create: { contactId, senderNumberId, optInStatus: "opted_out", optOutAt: at },
    update: { optInStatus: "opted_out", optOutAt: at },
  });
}
