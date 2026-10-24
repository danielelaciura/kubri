import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";
import { flowEdges } from "./graph";

export const KUBRI_GLOBAL_CONSENT = "kubri_global";

export function checkConsents(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  let mandatorySeen = false;
  const firstMandatory = c.flow.findIndex((step) => step.type === "consent" && !step.optional);

  c.flow.forEach((step, i) => {
    if (step.type !== "consent") return;

    // D48: one mandatory consent (the requesting organization's privacy); the only other
    // consent is the optional kubri_global, whose refusal keeps the candidate in this pool.
    if (!step.optional) {
      if (mandatorySeen) {
        issues.push(
          issue(
            `flow[${i}].optional`,
            "multiple_mandatory_consents",
            `Step "${step.id}" is a second mandatory consent: a campaign has exactly one (the only other consent is the optional kubri_global)`,
          ),
        );
      }
      mandatorySeen = true;
    }

    if (step.consentKey === KUBRI_GLOBAL_CONSENT && !step.optional) {
      issues.push(
        issue(
          `flow[${i}].optional`,
          "kubri_global_not_optional",
          "The kubri_global consent must be optional (spec §7.3)",
        ),
      );
    }

    // D54: sharing with the global pool only makes sense once the candidate exists (D24).
    if (
      step.consentKey === KUBRI_GLOBAL_CONSENT &&
      step.optional &&
      firstMandatory >= 0 &&
      i < firstMandatory
    ) {
      issues.push(
        issue(
          `flow[${i}]`,
          "kubri_global_before_mandatory_consent",
          `The kubri_global consent "${step.id}" must come after the mandatory consent in the flow`,
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

  issues.push(...checkDataBeforeConsent(c));

  return issues;
}

/**
 * Walks the flow from the first step without entering mandatory consent steps: whatever
 * `questions` or `cv_offer` step is still reached can collect data before the consent.
 */
function checkDataBeforeConsent(c: CampaignDefinition): CampaignIssue[] {
  const first = c.flow[0];
  if (!first) return [];
  const byId = new Map(c.flow.map((step, i) => [step.id, { step, i }]));
  const edges = flowEdges(c);
  const isGate = (id: string): boolean => {
    const step = byId.get(id)?.step;
    return step?.type === "consent" && !step.optional;
  };

  const reached = new Set<string>();
  const queue: string[] = [];
  if (!isGate(first.id)) {
    reached.add(first.id);
    queue.push(first.id);
  }
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const next of edges.get(id) ?? []) {
      if (!reached.has(next) && !isGate(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }

  const issues: CampaignIssue[] = [];
  c.flow.forEach((step, i) => {
    if ((step.type === "questions" || step.type === "cv_offer") && reached.has(step.id)) {
      issues.push(
        issue(
          `flow[${i}]`,
          "data_before_mandatory_consent",
          `Step "${step.id}" (${step.type}) can be reached without passing through a mandatory consent`,
        ),
      );
    }
  });
  return issues;
}
