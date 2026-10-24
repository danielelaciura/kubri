import type { CampaignDefinition } from "./schema/campaign";

/**
 * A stored, immutable campaign version as the rest of the system sees it. The runtime
 * (plan 08) pins sessions to `versionId`; the engine (plan 04) only reads `definition`.
 */
export interface LoadedCampaign {
  readonly versionId: string;
  readonly campaignId: string;
  readonly campaignSlug: string;
  readonly version: number;
  readonly definition: CampaignDefinition;
}
