import { duplicates, issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";

export function checkUniqueIds(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];

  for (const [step, i] of duplicates(c.flow, (s) => s.id)) {
    issues.push(issue(`flow[${i}].id`, "duplicate_step_id", `Step id "${step.id}" is used twice`));
  }

  const questions = c.flow.flatMap((step, stepIndex) =>
    step.type === "questions"
      ? step.questions.map((q, qIndex) => ({
          id: q.id,
          path: `flow[${stepIndex}].questions[${qIndex}].id`,
        }))
      : [],
  );
  for (const [q] of duplicates(questions, (x) => x.id)) {
    issues.push(issue(q.path, "duplicate_question_id", `Question id "${q.id}" is used twice`));
  }

  const consents = c.flow.flatMap((step, stepIndex) =>
    step.type === "consent"
      ? [{ key: step.consentKey, path: `flow[${stepIndex}].consentKey` }]
      : [],
  );
  for (const [consent] of duplicates(consents, (x) => x.key)) {
    issues.push(
      issue(consent.path, "duplicate_consent_key", `Consent key "${consent.key}" is used twice`),
    );
  }

  c.flow.forEach((step, stepIndex) => {
    if (step.type !== "choice") return;
    for (const [option, i] of duplicates(step.options, (o) => o.id)) {
      issues.push(
        issue(
          `flow[${stepIndex}].options[${i}].id`,
          "duplicate_option_id",
          `Option id "${option.id}" is used twice in step "${step.id}"`,
        ),
      );
    }
  });

  for (const [field, i] of duplicates(c.customFields, (f) => f.key)) {
    issues.push(
      issue(
        `customFields[${i}].key`,
        "duplicate_custom_field",
        `Custom field "${field.key}" is declared twice`,
      ),
    );
  }

  return issues;
}
