import type { Step, Target } from "./schema/steps";

/** The outcomes a step can produce. `end` produces none: it closes the session. */
export function stepOutcomes(step: Step): readonly string[] {
  switch (step.type) {
    case "message":
      return ["next"];
    case "choice":
      return step.options.map((option) => option.id);
    case "consent":
      return ["accepted", "declined"];
    case "questions":
      return ["completed", "terminated"];
    case "cv_offer":
      return ["yes", "no"];
    case "end":
      return [];
  }
}

export interface ResolvedTransition {
  /** Key in the campaign's `texts`, sent before moving on. */
  reply?: string;
  target: Target;
}

/**
 * Where an outcome leads. `nextStepId` is the id of the following step in `flow`
 * (undefined for the last step). Defaults are documented in plan 02.
 */
export function resolveTransition(
  step: Step,
  outcome: string,
  nextStepId: string | undefined,
): ResolvedTransition {
  // hasOwn: an outcome id such as "constructor" must not hit Object.prototype.
  const explicit =
    step.type === "end" || !step.on || !Object.hasOwn(step.on, outcome)
      ? undefined
      : step.on[outcome];
  if (explicit === undefined) return { target: defaultTarget(step, outcome, nextStepId) };
  if (typeof explicit === "string") return { target: explicit };
  return { reply: explicit.reply, target: explicit.then };
}

function defaultTarget(step: Step, outcome: string, nextStepId: string | undefined): Target {
  if (step.type === "questions" && outcome === "terminated") return "@stop";
  if (step.type === "consent" && outcome === "declined" && !step.optional) return "@stop";
  return nextStepId ?? "@end";
}
