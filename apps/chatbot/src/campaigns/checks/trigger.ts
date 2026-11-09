import { duplicates, issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";

export function checkTrigger(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  const { keywords, isDefault } = c.trigger;

  if (!isDefault && keywords.length === 0) {
    issues.push(
      issue(
        "trigger.keywords",
        "missing_keywords",
        "A campaign that is not the sender default needs at least one keyword",
      ),
    );
  }
  for (const [keyword, i] of duplicates(keywords, (k) => k)) {
    issues.push(
      issue(`trigger.keywords[${i}]`, "duplicate_keyword", `Keyword "${keyword}" is listed twice`),
    );
  }

  return issues;
}
