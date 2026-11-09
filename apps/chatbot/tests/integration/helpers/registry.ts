import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CampaignInput } from "../../../src/campaigns/schema/campaign";
import type { Database } from "../../../src/store/db";
import { createOrganization } from "../../../src/store/organizations";
import { createSenderNumber, type SenderNumberRecord } from "../../../src/store/senders";

/** The organizations and the sender number the campaign files refer to. */
export async function seedRegistry(db: Database): Promise<{ sender: SenderNumberRecord }> {
  const kubri = await createOrganization(db, { slug: "kubri", name: "Kubri S.r.l." });
  await createOrganization(db, { slug: "acme", name: "ACME S.r.l." });
  const sender = await createSenderNumber(db, {
    slug: "kubri-main",
    organizationId: kubri.id,
    phoneE164: "+393331234567",
    displayName: "Kubri",
    status: "active",
    provider: "meta",
    providerConfig: {
      phoneNumberId: "123456789012345",
      wabaId: "987654321098765",
      accessTokenSecret: "META_TOKEN_KUBRI_MAIN",
    },
  });
  return { sender };
}

export function loadStandardCampaign(): CampaignInput {
  const path = join(__dirname, "../../../campaigns/kubri-standard.json");
  return JSON.parse(readFileSync(path, "utf8")) as CampaignInput;
}
