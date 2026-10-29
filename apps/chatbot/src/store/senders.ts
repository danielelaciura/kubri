import type { MetaProviderConfig } from "../channels/provider-config";
import type { Database } from "./db";

export type SenderProvider = "meta" | "twilio";
export type SenderStatus = "provisioning" | "active" | "suspended";

export interface SenderNumberRecord {
  readonly id: string;
  readonly slug: string;
  readonly organizationId: string | null;
  readonly provider: SenderProvider;
  readonly phoneE164: string;
  readonly displayName: string;
  readonly status: SenderStatus;
}

export interface CreateSenderNumberInput {
  readonly slug: string;
  readonly organizationId: string | null;
  readonly phoneE164: string;
  readonly displayName: string;
  readonly status: SenderStatus;
  // v1 implements Meta only (spec D5); Twilio gets its own config schema when it arrives.
  readonly provider: "meta";
  readonly providerConfig: MetaProviderConfig;
}

const SELECT = {
  id: true,
  slug: true,
  organizationId: true,
  provider: true,
  phoneE164: true,
  displayName: true,
  status: true,
} as const;

export async function createSenderNumber(
  db: Database,
  input: CreateSenderNumberInput,
): Promise<SenderNumberRecord> {
  return db.senderNumber.create({
    data: { ...input, providerConfig: { ...input.providerConfig } },
    select: SELECT,
  });
}

export async function findSenderNumberBySlug(
  db: Database,
  slug: string,
): Promise<SenderNumberRecord | null> {
  return db.senderNumber.findUnique({ where: { slug }, select: SELECT });
}

export async function findSenderNumberByPhone(
  db: Database,
  phoneE164: string,
): Promise<SenderNumberRecord | null> {
  return db.senderNumber.findUnique({
    where: { channel_phoneE164: { channel: "whatsapp", phoneE164 } },
    select: SELECT,
  });
}

export interface OutboundSenderRecord {
  readonly id: string;
  readonly slug: string;
  readonly provider: SenderProvider;
  /** Identifiers and names of secrets, never credentials (spec §10.1). */
  readonly providerConfig: unknown;
}

/** The number a message leaves from, as a channel adapter needs it. */
export function findOutboundSender(db: Database, id: string): Promise<OutboundSenderRecord> {
  return db.senderNumber.findUniqueOrThrow({
    where: { id },
    select: { id: true, slug: true, provider: true, providerConfig: true },
  });
}
