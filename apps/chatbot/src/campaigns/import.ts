import type { NodeEnv } from "../config/env";
import { saveCampaignVersion, type SaveCampaignVersionResult } from "../store/campaigns";
import type { Database } from "../store/db";
import { canonicalCampaign } from "./checksum";
import type { CampaignIssue } from "./issues";
import { checkPublishable } from "./publishable";
import { validateCampaign } from "./validate";

export interface ImportCampaignOptions {
  readonly activate: boolean;
  readonly nodeEnv: NodeEnv;
  readonly importedBy?: string | null;
}

export type ImportCampaignResult =
  | (Extract<SaveCampaignVersionResult, { ok: true }> & { warnings: CampaignIssue[] })
  | { ok: false; issues: CampaignIssue[] };

/**
 * Validates first and touches the database only with a valid campaign: an invalid
 * campaign never reaches the DB (CLAUDE.md). Then stores it as an immutable version.
 */
export async function importCampaign(
  db: Database,
  input: unknown,
  options: ImportCampaignOptions,
): Promise<ImportCampaignResult> {
  const validation = validateCampaign(input);
  if (!validation.ok) return { ok: false, issues: validation.issues };

  const publishable = checkPublishable(validation.campaign, options.nodeEnv);
  if (publishable.errors.length > 0) return { ok: false, issues: publishable.errors };

  const { json, checksum } = canonicalCampaign(validation.campaign);
  const saved = await saveCampaignVersion(db, {
    definition: validation.campaign,
    canonical: json,
    checksum,
    activate: options.activate,
    importedBy: options.importedBy ?? null,
  });
  return saved.ok ? { ...saved, warnings: publishable.warnings } : saved;
}
