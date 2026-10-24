import type { NodeEnv } from "../config/env";
import { issue, type CampaignIssue } from "./issues";
import type { CampaignDefinition } from "./schema/campaign";

/** Spec D23 / Appendix A: placeholder consent texts must never reach production. */
export const PLACEHOLDER_TEXT_VERSION_PREFIX = "placeholder-";

export function placeholderConsentIssues(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  c.flow.forEach((step, i) => {
    if (step.type === "consent" && step.textVersion.startsWith(PLACEHOLDER_TEXT_VERSION_PREFIX)) {
      issues.push(
        issue(
          `flow[${i}].textVersion`,
          "placeholder_consent",
          `Consent "${step.consentKey}" uses the placeholder text version "${step.textVersion}": not allowed in production`,
        ),
      );
    }
  });
  return issues;
}

export interface PublishCheck {
  /** Block the import. */
  readonly errors: CampaignIssue[];
  /** Printed, but the import goes ahead. */
  readonly warnings: CampaignIssue[];
}

/** Placeholder consents are errors in production and warnings everywhere else. */
export function checkPublishable(c: CampaignDefinition, nodeEnv: NodeEnv): PublishCheck {
  const placeholders = placeholderConsentIssues(c);
  return nodeEnv === "production"
    ? { errors: placeholders, warnings: [] }
    : { errors: [], warnings: placeholders };
}
