import { stepOutcomes } from "../flow";
import { issue, type CampaignIssue } from "../issues";
import type { CampaignDefinition } from "../schema/campaign";
import { SPECIAL_TARGETS, type Target } from "../schema/steps";

export function checkTransitions(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  const stepIds = new Set(c.flow.map((step) => step.id));
  const isSpecial = (t: Target): boolean => (SPECIAL_TARGETS as readonly string[]).includes(t);

  c.flow.forEach((step, i) => {
    if (step.type === "end" || !step.on) return;
    const outcomes = stepOutcomes(step);

    for (const [outcome, transition] of Object.entries(step.on)) {
      const path = `flow[${i}].on.${outcome}`;
      if (!outcomes.includes(outcome)) {
        issues.push(
          issue(
            path,
            "unknown_outcome",
            `Step "${step.id}" (${step.type}) has no outcome "${outcome}"; expected one of: ${outcomes.join(", ")}`,
          ),
        );
      }

      const target = typeof transition === "string" ? transition : transition.then;
      const targetPath = typeof transition === "string" ? path : `${path}.then`;
      if (!isSpecial(target) && !stepIds.has(target)) {
        issues.push(
          issue(
            targetPath,
            "unknown_target",
            `Target "${target}" is not a step id nor @stop / @repeat / @end`,
          ),
        );
      }
      if (target === "@repeat" && step.type === "message") {
        issues.push(
          issue(
            targetPath,
            "repeat_on_message",
            `Step "${step.id}" is a message and does not wait for an answer: @repeat would loop`,
          ),
        );
      }
      // Spec D24: a refused mandatory consent must end the conversation.
      if (
        step.type === "consent" &&
        !step.optional &&
        outcome === "declined" &&
        target !== "@stop"
      ) {
        issues.push(
          issue(
            targetPath,
            "mandatory_consent_declined_not_stop",
            `Consent "${step.id}" is mandatory: declining it must lead to @stop, not "${target}"`,
          ),
        );
      }
    }
  });

  return issues;
}
