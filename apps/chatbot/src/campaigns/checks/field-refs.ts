import { resolveField } from "../../profile/field-ref";
import { conditionRefs } from "../conditions/evaluate";
import { stepOutcomes } from "../flow";
import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";
import type { Condition } from "../schema/conditions";

export function checkFieldRefs(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  const stepsById = new Map(c.flow.map((step) => [step.id, step]));
  const askedFields = new Set<string>();

  const checkCondition = (condition: Condition | undefined, path: string): void => {
    if (!condition) return;
    const refs = conditionRefs(condition);
    for (const field of refs.fields) {
      if (!resolveField(field, c.customFields)) {
        issues.push(
          issue(path, "unknown_condition_field", `Condition refers to unknown field "${field}"`),
        );
      }
    }
    for (const { step: stepId, outcome } of refs.outcomes) {
      const step = stepsById.get(stepId);
      if (!step) {
        issues.push(
          issue(path, "unknown_condition_step", `Condition refers to unknown step "${stepId}"`),
        );
      } else if (!stepOutcomes(step).includes(outcome)) {
        issues.push(
          issue(path, "unknown_condition_outcome", `Step "${stepId}" has no outcome "${outcome}"`),
        );
      }
    }
  };

  c.flow.forEach((step, i) => {
    checkCondition(step.when, `flow[${i}].when`);
    if (step.type !== "questions") return;

    step.questions.forEach((q, qi) => {
      const path = `flow[${i}].questions[${qi}]`;
      const def = resolveField(q.field, c.customFields);
      if (!def) {
        issues.push(
          issue(
            `${path}.field`,
            "unknown_field",
            `Field "${q.field}" is neither standard nor declared in customFields`,
          ),
        );
      } else if (def.systemOnly === true) {
        issues.push(
          issue(
            `${path}.field`,
            "system_only_field",
            `Field "${q.field}" is written by the system only`,
          ),
        );
      } else if (askedFields.has(q.field)) {
        issues.push(
          issue(
            `${path}.field`,
            "duplicate_field_question",
            `Field "${q.field}" is already asked by another question`,
          ),
        );
      }
      askedFields.add(q.field);
      checkCondition(q.when, `${path}.when`);
      checkCondition(q.terminateIf, `${path}.terminateIf`);
    });
  });

  return issues;
}
