import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";

export const KUBRI_GLOBAL_CONSENT = "kubri_global";

export function checkConsents(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];

  c.flow.forEach((step, i) => {
    if (step.type !== "consent") return;

    if (step.consentKey === KUBRI_GLOBAL_CONSENT && !step.optional) {
      issues.push(
        issue(
          `flow[${i}].optional`,
          "kubri_global_not_optional",
          "The kubri_global consent must be optional (spec §7.3)",
        ),
      );
    }

    if (!step.optional) {
      // A skippable mandatory consent would let the candidate bypass the D24 threshold.
      if (step.when) {
        issues.push(
          issue(
            `flow[${i}].when`,
            "conditional_mandatory_consent",
            `Mandatory consent step "${step.id}" cannot have a \`when\` condition: it could be skipped`,
          ),
        );
      }
    }
  });

  const hasMandatory = c.flow.some((step) => step.type === "consent" && !step.optional);
  if (!hasMandatory) {
    issues.push(
      issue(
        "flow",
        "missing_mandatory_consent",
        "The flow needs at least one mandatory consent step (optional: false): without it the consent threshold is never crossed",
      ),
    );
  }

  return issues;
}
