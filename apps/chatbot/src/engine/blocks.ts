import { evaluateCondition } from "../campaigns/conditions/evaluate";
import type { Question, QuestionsStep } from "../campaigns/schema/steps";
import { isFieldSettled } from "./profile-snapshot";
import { conditionContext, type SessionState } from "./state";

export type NextQuestion =
  | { readonly kind: "ask"; readonly question: Question }
  | { readonly kind: "completed" }
  | { readonly kind: "terminated" };

/**
 * The next question to ask from `fromIndex` on (spec §5.3, §7.2 point 7):
 * - `when` false → skipped, its terminateIf is not evaluated;
 * - field already settled → skipped, but its terminateIf is evaluated (an early answer can
 *   terminate the block too);
 * - otherwise → asked.
 */
export function nextAskableQuestion(
  step: QuestionsStep,
  fromIndex: number,
  state: SessionState,
): NextQuestion {
  const ctx = conditionContext(state);
  for (const question of step.questions.slice(fromIndex)) {
    if (question.when && !evaluateCondition(question.when, ctx)) continue;
    if (!isFieldSettled(state.profile, question.field)) return { kind: "ask", question };
    if (question.terminateIf && evaluateCondition(question.terminateIf, ctx)) {
      return { kind: "terminated" };
    }
  }
  return { kind: "completed" };
}
