import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { Step } from "../campaigns/schema/steps";
import type { Effect, SendPurpose } from "./effects";
import type { SessionState } from "./state";
import type { SystemTextKey, TextParams, TextRef } from "./text-ref";

/**
 * Spec §7.2 point 9: at most 20 automatic step entries per turn. Counts every step entered,
 * including the one that ends up waiting for an answer.
 */
export const MAX_AUTO_ADVANCES = 20;

export type EngineErrorReason = "auto_advance_limit" | "incoherent_state";

/** Thrown inside the engine and caught by step(): it never escapes as an exception (D45). */
export class EngineError extends Error {
  readonly reason: EngineErrorReason;

  constructor(reason: EngineErrorReason, message: string) {
    super(message);
    this.name = "EngineError";
    this.reason = reason;
  }
}

export function incoherent(message: string): never {
  throw new EngineError("incoherent_state", message);
}

/**
 * The working copy of one step() call. It is mutated locally and never leaves step(), so
 * step() stays pure.
 */
export interface Turn {
  readonly campaign: CampaignDefinition;
  /** The event's timestamp. */
  readonly at: string;
  state: SessionState;
  readonly effects: Effect[];
  /** Steps entered so far in this turn. */
  advances: number;
}

export function createTurn(state: SessionState, campaign: CampaignDefinition, at: string): Turn {
  return { campaign, at, state, effects: [], advances: 0 };
}

export function emit(turn: Turn, ...effects: Effect[]): void {
  turn.effects.push(...effects);
}

export function setState(turn: Turn, changes: Partial<SessionState>): void {
  turn.state = { ...turn.state, ...changes };
}

export function say(turn: Turn, text: TextRef, purpose?: SendPurpose): void {
  emit(turn, purpose ? { type: "SendText", text, purpose } : { type: "SendText", text });
}

export function systemText(key: SystemTextKey, params?: TextParams): TextRef {
  return params ? { kind: "system", key, params } : { kind: "system", key };
}

export function stepAt(turn: Turn, index: number): Step {
  return turn.campaign.flow[index] ?? incoherent(`no step at index ${index}`);
}

export interface CurrentStep {
  readonly step: Step;
  readonly index: number;
}

export function currentStep(turn: Turn): CurrentStep {
  const id = turn.state.stepId;
  const index = id === null ? -1 : turn.campaign.flow.findIndex((s) => s.id === id);
  const step = turn.campaign.flow[index];
  if (!step) incoherent(`unknown current step "${id ?? "none"}"`);
  return { step, index };
}
