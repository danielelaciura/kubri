import type { CampaignIssue } from "../campaigns/issues";
import type { NodeEnv } from "../config/env";

/** One issue per line: "  ✗ flow[3].questions[1].field  unknown_field: Field …". */
export function formatIssues(issues: readonly CampaignIssue[], marker = "✗"): string[] {
  return issues.map((i) => `  ${marker} ${i.path || "(root)"}  ${i.code}: ${i.message}`);
}

/**
 * The environment the placeholder-consent guard used. Printed next to placeholder issues so
 * nobody has to guess why the same file is a warning on one machine and an error on another.
 */
export function describeEnvironment(nodeEnv: NodeEnv | undefined): string {
  if (nodeEnv === "development" || nodeEnv === "test") {
    return `  environment: NODE_ENV=${nodeEnv} (placeholder consents are warnings)`;
  }
  const shown = nodeEnv ?? "unset";
  return `  environment: NODE_ENV=${shown} (placeholder consents are errors: only development and test allow them)`;
}

export function hasPlaceholderIssue(issues: readonly CampaignIssue[]): boolean {
  return issues.some((i) => i.code === "placeholder_consent");
}
