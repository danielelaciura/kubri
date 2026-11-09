import { runSemanticChecks } from "./checks";
import type { CampaignIssue } from "./issues";
import { CampaignDefinitionSchema, type CampaignDefinition } from "./schema/campaign";

export type CampaignValidationResult =
  { ok: true; campaign: CampaignDefinition } | { ok: false; issues: CampaignIssue[] };

/**
 * Shape first (Zod), then meaning (semantic checks). Keyword collisions with other
 * campaigns need the database and are checked at import time (plan 03).
 */
export function validateCampaign(input: unknown): CampaignValidationResult {
  const parsed = CampaignDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: formatPath(i.path),
        code: "schema",
        message: i.message,
      })),
    };
  }
  const issues = runSemanticChecks(parsed.data);
  return issues.length === 0 ? { ok: true, campaign: parsed.data } : { ok: false, issues };
}

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`))
    .join("")
    .replace(/^\./, "");
}
