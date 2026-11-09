import { evaluateCondition, type ConditionContext } from "../campaigns/conditions/evaluate";
import type { Step } from "../campaigns/schema/steps";

export interface SectionProgress {
  readonly current: number;
  readonly total: number;
}

/**
 * "Sezione N di M" (spec §7.2 point 8). M counts the questions blocks whose `when` does not
 * exclude them right now, so it can change as the profile fills up (D42).
 */
export function sectionProgress(
  flow: readonly Step[],
  stepIndex: number,
  ctx: ConditionContext,
): SectionProgress {
  const sections = flow.flatMap((step, index) =>
    step.type === "questions" && (!step.when || evaluateCondition(step.when, ctx)) ? [index] : [],
  );
  return {
    current: sections.filter((index) => index <= stepIndex).length,
    total: sections.length,
  };
}
