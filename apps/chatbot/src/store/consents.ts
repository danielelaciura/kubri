import { createHmac } from "node:crypto";
import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { Tx } from "./db";
import { asJson } from "./json";

/**
 * The minimal proof left when the contact is deleted (spec §10.6, D109). Keyed (HMAC-SHA256
 * with CONSENT_HASH_SECRET): a plain hash of a phone number is reversed by trying them all.
 */
export function contactHash(secret: string, channel: string, externalId: string): string {
  return createHmac("sha256", secret).update(`${channel}:${externalId}`, "utf8").digest("hex");
}

export interface ConsentInput {
  readonly contactId: string;
  readonly channel: string;
  readonly externalId: string;
  readonly sessionId: string;
  readonly consentKey: string;
  readonly textVersion: string;
  readonly language: string;
  /** The exact text shown to the candidate (CLAUDE.md, privacy rule 1). */
  readonly textShown: string;
  readonly textShownIsCurated: boolean;
  /** The official text's link shown with a text that is not curated; null when none was. */
  readonly linkShown: string | null;
  readonly dataController: CampaignDefinition["dataController"];
  readonly outcome: "accepted" | "declined";
  readonly messageId: string | null;
  readonly decidedAt: Date;
}

export async function insertConsent(
  tx: Tx,
  input: ConsentInput,
  hashSecret: string,
): Promise<void> {
  const { channel, externalId, ...rest } = input;
  await tx.consent.create({
    data: {
      ...rest,
      dataController: asJson(rest.dataController),
      contactHash: contactHash(hashSecret, channel, externalId),
    },
  });
}
