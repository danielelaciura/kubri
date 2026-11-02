import { z } from "zod";
import { parseStoredProfile, type StoredProfile } from "../runtime/profile-codec";
import { StoredDataError } from "../runtime/stored-data-error";
import type { Tx } from "./db";
import type { SessionStatusName } from "./sessions";

/** The campaign's definition has more; the jobs only need its pool key. */
const DefinitionSchema = z.object({ externalKey: z.string().min(1) });

export interface Snapshot {
  readonly sessionId: string;
  readonly contact: {
    readonly id: string;
    readonly channel: "whatsapp";
    readonly externalId: string;
    readonly phoneE164: string;
  };
  readonly campaign: {
    readonly id: string;
    readonly externalKey: string;
    readonly version: number;
    readonly versionId: string;
  };
  readonly session: {
    readonly status: SessionStatusName;
    readonly language: string | null;
    readonly senderNumberId: string;
  };
  readonly profile: StoredProfile & {
    readonly id: string;
    readonly sharedWithGlobal: boolean;
    readonly updatedAt: Date;
  };
}

/**
 * Everything the integration jobs need, read together at the moment they run (D125, R5).
 * null = the session is gone (the contact was deleted): there is nothing to send.
 */
export async function loadSnapshot(tx: Tx, sessionId: string): Promise<Snapshot | null> {
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      language: true,
      senderNumberId: true,
      contact: { select: { id: true, channel: true, externalId: true, phoneE164: true } },
      profile: {
        select: {
          id: true,
          standard: true,
          custom: true,
          fieldMeta: true,
          sharedWithGlobal: true,
          updatedAt: true,
        },
      },
      campaignVersion: {
        select: { id: true, campaignId: true, version: true, definition: true },
      },
    },
  });
  if (!session?.profile) return null;
  const definition = DefinitionSchema.safeParse(session.campaignVersion.definition);
  if (!definition.success) throw new StoredDataError("the stored campaign has no pool key");
  const { profile, contact, campaignVersion } = session;
  return {
    sessionId: session.id,
    contact: {
      id: contact.id,
      channel: contact.channel,
      externalId: contact.externalId,
      phoneE164: contact.phoneE164,
    },
    campaign: {
      id: campaignVersion.campaignId,
      externalKey: definition.data.externalKey,
      version: campaignVersion.version,
      versionId: campaignVersion.id,
    },
    session: {
      status: session.status,
      language: session.language,
      senderNumberId: session.senderNumberId,
    },
    profile: {
      ...parseStoredProfile({
        standard: profile.standard,
        custom: profile.custom,
        fieldMeta: profile.fieldMeta,
      }),
      id: profile.id,
      sharedWithGlobal: profile.sharedWithGlobal,
      updatedAt: profile.updatedAt,
    },
  };
}
