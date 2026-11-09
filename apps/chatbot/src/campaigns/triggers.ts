import { issue, type CampaignIssue } from "./issues";
import type { CampaignDefinition } from "./schema/campaign";

/** How an active campaign is reached on a sender number. */
export interface CampaignTrigger {
  readonly slug: string;
  readonly keywords: readonly string[];
  readonly isDefault: boolean;
}

/**
 * Spec §5.8 (last bullet): keywords must not collide with another active campaign on the
 * same number, and a number has at most one default campaign. `others` are the active
 * campaigns of the same sender; the campaign itself (same slug) is ignored.
 * Keywords are compared exactly: the schema already trims and lowercases them.
 */
export function findTriggerCollisions(
  campaign: CampaignDefinition,
  others: readonly CampaignTrigger[],
): CampaignIssue[] {
  const rivals = others.filter((other) => other.slug !== campaign.campaign);
  const issues: CampaignIssue[] = [];

  campaign.trigger.keywords.forEach((keyword, i) => {
    for (const rival of rivals) {
      if (rival.keywords.includes(keyword)) {
        issues.push(
          issue(
            `trigger.keywords[${i}]`,
            "keyword_collision",
            `Keyword "${keyword}" is already used by active campaign "${rival.slug}" on sender "${campaign.trigger.sender}"`,
          ),
        );
      }
    }
  });

  if (campaign.trigger.isDefault) {
    for (const rival of rivals.filter((r) => r.isDefault)) {
      issues.push(
        issue(
          "trigger.isDefault",
          "duplicate_default_campaign",
          `Active campaign "${rival.slug}" is already the default on sender "${campaign.trigger.sender}"`,
        ),
      );
    }
  }

  return issues;
}
