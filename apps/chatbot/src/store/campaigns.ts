import type { JsonObject } from "../campaigns/checksum";
import type { CampaignIssue } from "../campaigns/issues";
import type { LoadedCampaign } from "../campaigns/loaded-campaign";
import { CampaignDefinitionSchema, type CampaignDefinition } from "../campaigns/schema/campaign";
import { findTriggerCollisions } from "../campaigns/triggers";
import type { Database } from "./db";

export type CampaignStatus = "active" | "paused" | "archived";

export interface SaveCampaignVersionInput {
  /** Already validated by validateCampaign (an invalid campaign never gets here). */
  readonly definition: CampaignDefinition;
  readonly canonical: JsonObject;
  readonly checksum: string;
  readonly activate: boolean;
  readonly importedBy: string | null;
}

export type SaveCampaignVersionResult =
  | {
      ok: true;
      /** "unchanged": a version with the same checksum already existed and was reused. */
      outcome: "created" | "unchanged";
      campaignId: string;
      versionId: string;
      version: number;
      /** Whether this version is the campaign's active one after the import. */
      active: boolean;
    }
  | { ok: false; issues: CampaignIssue[] };

/**
 * Stores a campaign version in one serializable transaction: resolves organization and
 * sender by slug, checks trigger collisions against the other active campaigns of the
 * sender, reuses an identical version (same checksum) or creates version N+1, and
 * optionally activates it.
 */
export async function saveCampaignVersion(
  db: Database,
  input: SaveCampaignVersionInput,
): Promise<SaveCampaignVersionResult> {
  const { definition } = input;

  return db.$transaction(
    async (tx): Promise<SaveCampaignVersionResult> => {
      const organization = await tx.organization.findUnique({
        where: { slug: definition.organization },
      });
      if (!organization) {
        return failure(
          "organization",
          "unknown_organization",
          `Organization "${definition.organization}" does not exist (create it with: orgs add)`,
        );
      }
      const sender = await tx.senderNumber.findUnique({
        where: { slug: definition.trigger.sender },
      });
      if (!sender) {
        return failure(
          "trigger.sender",
          "unknown_sender",
          `Sender number "${definition.trigger.sender}" does not exist (create it with: senders add)`,
        );
      }

      let campaign = await tx.campaign.findUnique({ where: { slug: definition.campaign } });
      if (campaign && campaign.organizationId !== organization.id) {
        return failure(
          "organization",
          "organization_mismatch",
          `Campaign "${definition.campaign}" belongs to another organization`,
        );
      }

      const others = await tx.campaign.findMany({
        where: { senderNumberId: sender.id, status: "active", slug: { not: definition.campaign } },
        select: { slug: true, keywords: true, isDefault: true },
      });
      const collisions = findTriggerCollisions(definition, others);
      if (collisions.length > 0) return { ok: false, issues: collisions };

      const routing = {
        senderNumberId: sender.id,
        keywords: definition.trigger.keywords,
        isDefault: definition.trigger.isDefault,
        externalKey: definition.externalKey,
      };
      campaign ??= await tx.campaign.create({
        data: { slug: definition.campaign, organizationId: organization.id, ...routing },
      });

      let outcome: "created" | "unchanged" = "unchanged";
      let version = await tx.campaignVersion.findUnique({
        where: { campaignId_checksum: { campaignId: campaign.id, checksum: input.checksum } },
      });
      if (!version) {
        const latest = await tx.campaignVersion.aggregate({
          where: { campaignId: campaign.id },
          _max: { version: true },
        });
        version = await tx.campaignVersion.create({
          data: {
            campaignId: campaign.id,
            version: (latest._max.version ?? 0) + 1,
            definition: input.canonical,
            checksum: input.checksum,
            importedBy: input.importedBy,
          },
        });
        outcome = "created";
      }

      if (input.activate) {
        campaign = await tx.campaign.update({
          where: { id: campaign.id },
          data: { ...routing, status: "active", activeVersionId: version.id },
        });
      } else if (campaign.activeVersionId === null) {
        // Never activated: the routing columns follow the latest import.
        campaign = await tx.campaign.update({ where: { id: campaign.id }, data: routing });
      }

      return {
        ok: true,
        outcome,
        campaignId: campaign.id,
        versionId: version.id,
        version: version.version,
        active: campaign.status === "active" && campaign.activeVersionId === version.id,
      };
    },
    { isolationLevel: "Serializable" },
  );
}

function failure(path: string, code: string, message: string): SaveCampaignVersionResult {
  return { ok: false, issues: [{ path, code, message }] };
}

export interface CampaignSummary {
  readonly slug: string;
  readonly organizationSlug: string;
  readonly senderSlug: string;
  readonly status: CampaignStatus;
  readonly isDefault: boolean;
  readonly keywords: readonly string[];
  readonly activeVersion: number | null;
  readonly latestVersion: number;
}

export async function listCampaigns(db: Database): Promise<CampaignSummary[]> {
  const rows = await db.campaign.findMany({
    orderBy: { slug: "asc" },
    include: {
      organization: { select: { slug: true } },
      senderNumber: { select: { slug: true } },
      activeVersion: { select: { version: true } },
      versions: { select: { version: true }, orderBy: { version: "desc" }, take: 1 },
    },
  });
  return rows.map((row) => ({
    slug: row.slug,
    organizationSlug: row.organization.slug,
    senderSlug: row.senderNumber.slug,
    status: row.status,
    isDefault: row.isDefault,
    keywords: row.keywords,
    activeVersion: row.activeVersion?.version ?? null,
    latestVersion: row.versions[0]?.version ?? 0,
  }));
}

const WITH_ACTIVE_VERSION = { activeVersion: true } as const;

/** The active campaign on a sender whose keywords include `keyword` (normalized here). */
export async function findActiveCampaignByKeyword(
  db: Database,
  senderNumberId: string,
  keyword: string,
): Promise<LoadedCampaign | null> {
  const row = await db.campaign.findFirst({
    where: { senderNumberId, status: "active", keywords: { has: keyword.trim().toLowerCase() } },
    include: WITH_ACTIVE_VERSION,
  });
  return row?.activeVersion ? toLoaded(row.slug, row.activeVersion) : null;
}

/** The active default campaign of a sender (`trigger.isDefault`), if any. */
export async function findDefaultCampaign(
  db: Database,
  senderNumberId: string,
): Promise<LoadedCampaign | null> {
  const row = await db.campaign.findFirst({
    where: { senderNumberId, status: "active", isDefault: true },
    include: WITH_ACTIVE_VERSION,
  });
  return row?.activeVersion ? toLoaded(row.slug, row.activeVersion) : null;
}

/** A specific version, active or not: sessions stay pinned to the version they started on. */
export async function findCampaignVersion(
  db: Database,
  versionId: string,
): Promise<LoadedCampaign | null> {
  const row = await db.campaignVersion.findUnique({
    where: { id: versionId },
    include: { campaign: { select: { slug: true } } },
  });
  return row ? toLoaded(row.campaign.slug, row) : null;
}

interface VersionRow {
  readonly id: string;
  readonly campaignId: string;
  readonly version: number;
  readonly definition: unknown;
}

function toLoaded(campaignSlug: string, row: VersionRow): LoadedCampaign {
  return {
    versionId: row.id,
    campaignId: row.campaignId,
    campaignSlug,
    version: row.version,
    // Stored definitions were validated on import; parsing restores the static type.
    definition: CampaignDefinitionSchema.parse(row.definition),
  };
}
