import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";
import type { Step, TextValue } from "../schema/steps";

export function checkTextRefs(c: CampaignDefinition): CampaignIssue[] {
  const declared = new Set(Object.keys(c.texts));
  const issues: CampaignIssue[] = [];

  const check = (key: string, path: string): void => {
    if (!declared.has(key)) {
      issues.push(issue(path, "unknown_text_ref", `Text "${key}" is not declared in texts`));
    }
  };

  c.flow.forEach((step, i) => {
    for (const { value, path } of stepTexts(step, `flow[${i}]`)) {
      if ("ref" in value && typeof value.ref === "string") check(value.ref, `${path}.ref`);
    }
    if (step.type === "end" || !step.on) return;
    for (const [outcome, transition] of Object.entries(step.on)) {
      if (typeof transition !== "string") check(transition.reply, `flow[${i}].on.${outcome}.reply`);
    }
  });

  return issues;
}

/** Every text a step sends, in document order, with its JSON path. */
export function stepTexts(step: Step, path: string): { value: TextValue; path: string }[] {
  switch (step.type) {
    case "message":
    case "end":
    case "consent":
      return [{ value: step.text, path: `${path}.text` }];
    case "choice":
    case "cv_offer":
      return [{ value: step.prompt, path: `${path}.prompt` }];
    case "questions":
      return [
        ...(step.title ? [{ value: step.title, path: `${path}.title` }] : []),
        ...step.questions.map((q, qi) => ({
          value: q.prompt,
          path: `${path}.questions[${qi}].prompt`,
        })),
      ];
  }
}
