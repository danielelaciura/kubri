import type { CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";
import { checkConsents } from "./consents";
import { checkFieldRefs } from "./field-refs";
import { checkGraph } from "./graph";
import { checkTextRefs } from "./text-refs";
import { checkTransitions } from "./transitions";
import { checkTrigger } from "./trigger";
import { checkUniqueIds } from "./unique-ids";

const CHECKS: readonly ((c: CampaignDefinition) => CampaignIssue[])[] = [
  checkUniqueIds,
  checkTextRefs,
  checkFieldRefs,
  checkTransitions,
  checkGraph,
  checkTrigger,
  checkConsents,
];

export function runSemanticChecks(c: CampaignDefinition): CampaignIssue[] {
  return CHECKS.flatMap((check) => check(c));
}
