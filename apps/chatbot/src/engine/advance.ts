import { evaluateCondition } from "../campaigns/conditions/evaluate";
import { nextEligibleStep, resolveTransition } from "../campaigns/flow";
import type { ConsentStep, Question, QuestionsStep, Target } from "../campaigns/schema/steps";
import { nextAskableQuestion } from "./blocks";
import type { DataPolicy, SendPurpose, StopReason } from "./effects";
import { sectionProgress } from "./progress";
import { conditionContext } from "./state";
import { stepTextRef, type TextParams, type TextRef } from "./text-ref";
import {
  EngineError,
  MAX_AUTO_ADVANCES,
  emit,
  incoherent,
  say,
  setState,
  stepAt,
  systemText,
  type Turn,
} from "./turn";

/** Enters the first eligible step at or after `fromIndex` (spec §7.2 points 6–7). */
export function enterStep(turn: Turn, fromIndex: number): void {
  const index = nextEligibleStep(turn.campaign.flow, fromIndex, conditionContext(turn.state));
  if (index === undefined) {
    endFlow(turn);
    return;
  }
  runStep(turn, index);
}

/** Sends a step's opening texts; a step that needs no answer moves on immediately. */
export function runStep(turn: Turn, index: number): void {
  turn.advances += 1;
  if (turn.advances > MAX_AUTO_ADVANCES) {
    throw new EngineError("auto_advance_limit", `more than ${MAX_AUTO_ADVANCES} steps in one turn`);
  }
  const step = stepAt(turn, index);
  setState(turn, { stepId: step.id, questionId: null, clarifications: 0 });
  switch (step.type) {
    case "message":
      say(turn, stepTextRef(step.text, step.id));
      followOutcome(turn, index, "next");
      return;
    case "choice":
    case "cv_offer":
      say(turn, stepTextRef(step.prompt, step.id));
      return;
    case "consent":
      say(turn, consentTextRef(turn, step));
      return;
    case "questions":
      startBlock(turn, index, step);
      return;
    case "end":
      completeSession(turn, stepTextRef(step.text, step.id));
      return;
  }
}

/** Records the outcome, sends the transition's reply, goes to its target (spec §5.4). */
export function followOutcome(
  turn: Turn,
  index: number,
  outcome: string,
  stopReason: StopReason = "flow_stop",
): void {
  const step = stepAt(turn, index);
  setState(turn, { outcomes: { ...turn.state.outcomes, [step.id]: outcome } });
  const { reply, target } = resolveTransition(step, outcome, turn.campaign.flow[index + 1]?.id);
  if (reply !== undefined) say(turn, { kind: "campaign", key: reply });
  goTo(turn, target, index, stopReason);
}

function goTo(turn: Turn, target: Target, fromIndex: number, stopReason: StopReason): void {
  if (target === "@stop") {
    stopSession(turn, stopReason);
    return;
  }
  if (target === "@end") {
    endFlow(turn);
    return;
  }
  if (target === "@repeat") {
    runStep(turn, fromIndex);
    return;
  }
  const index = turn.campaign.flow.findIndex((s) => s.id === target);
  if (index < 0) incoherent(`unknown target "${target}"`);
  enterStep(turn, index);
}

/** `@end` and running out of steps: the first eligible `end` step, else a system closing (D37). */
export function endFlow(turn: Turn): void {
  const ctx = conditionContext(turn.state);
  const index = turn.campaign.flow.findIndex(
    (s) => s.type === "end" && (!s.when || evaluateCondition(s.when, ctx)),
  );
  if (index >= 0) {
    runStep(turn, index);
    return;
  }
  completeSession(turn, systemText("system.closing"));
}

/**
 * Closing the flow. Before the consent threshold no candidate exists on Kubri and nothing may
 * be kept (D24): the closing text is sent and the session stops with deletion.
 */
function completeSession(turn: Turn, closing: TextRef): void {
  if (!turn.state.consentsAccepted) {
    stopSession(turn, "ended_before_consent", { goodbye: closing, dataPolicy: "delete" });
    return;
  }
  say(turn, closing);
  emit(
    turn,
    { type: "CompleteSession", at: turn.at },
    { type: "EnqueueJob", job: { name: "kubri-webhook", event: "interview.completed" } },
  );
  setState(turn, {
    phase: "post_completion",
    stepId: null,
    questionId: null,
    clarifications: 0,
    pendingConfirmation: null,
  });
}

export interface StopOptions {
  readonly goodbye?: TextRef;
  readonly dataPolicy?: DataPolicy;
}

/** `@stop`, opt-out and deletion. Before the consent threshold nothing is kept (D24, D39). */
export function stopSession(turn: Turn, reason: StopReason, options: StopOptions = {}): void {
  const dataPolicy =
    options.dataPolicy ?? (turn.state.consentsAccepted ? turn.campaign.onStop.data : "delete");
  say(turn, options.goodbye ?? systemText("system.stopped"));
  emit(turn, { type: "StopSession", reason, dataPolicy, at: turn.at });
  setState(turn, {
    phase: "closed",
    stepId: null,
    questionId: null,
    clarifications: 0,
    pendingConfirmation: null,
  });
}

export function consentTextRef(turn: Turn, step: ConsentStep): TextRef {
  const { name, privacyUrl } = turn.campaign.dataController;
  const params: TextParams = {
    "dataController.name": name,
    "dataController.privacyUrl": privacyUrl,
    ...(step.link ? { link: step.link } : {}),
  };
  return stepTextRef(step.text, step.id, params);
}

export function questionTextRef(
  step: QuestionsStep,
  question: Question,
  params?: TextParams,
): TextRef {
  return stepTextRef(question.prompt, `${step.id}.${question.id}`, params);
}

export function askQuestion(
  turn: Turn,
  step: QuestionsStep,
  question: Question,
  purpose?: SendPurpose,
  params?: TextParams,
): void {
  setState(turn, { questionId: question.id });
  say(turn, questionTextRef(step, question, params), purpose);
}

function startBlock(turn: Turn, index: number, step: QuestionsStep): void {
  const next = nextAskableQuestion(step, 0, turn.state);
  if (next.kind !== "ask") {
    finishBlock(turn, index, next.kind);
    return;
  }
  const { current, total } = sectionProgress(
    turn.campaign.flow,
    index,
    conditionContext(turn.state),
  );
  say(turn, systemText("system.progress", { current, total }));
  if (step.title) say(turn, stepTextRef(step.title, `${step.id}.title`));
  askQuestion(turn, step, next.question);
}

/** Moves past the current question: its terminateIf first, then the next askable question. */
export function advanceFromQuestion(
  turn: Turn,
  index: number,
  step: QuestionsStep,
  question: Question,
): void {
  if (
    question.terminateIf &&
    evaluateCondition(question.terminateIf, conditionContext(turn.state))
  ) {
    finishBlock(turn, index, "terminated");
    return;
  }
  const position = step.questions.findIndex((q) => q.id === question.id);
  const next = nextAskableQuestion(step, position + 1, turn.state);
  if (next.kind !== "ask") {
    finishBlock(turn, index, next.kind);
    return;
  }
  setState(turn, { clarifications: 0 });
  askQuestion(turn, step, next.question);
}

function finishBlock(turn: Turn, index: number, outcome: "completed" | "terminated"): void {
  setState(turn, { questionId: null });
  if (outcome === "completed") {
    emit(turn, { type: "EnqueueJob", job: { name: "kubri-webhook", event: "block.completed" } });
  }
  followOutcome(turn, index, outcome, outcome === "terminated" ? "terminated" : "flow_stop");
}
