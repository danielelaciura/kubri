import type { Logger } from "pino";
import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { Effect } from "../engine/effects";
import type { EngineEvent } from "../engine/events";
import type { Interpretation } from "../engine/interpretation";
import type { SessionState } from "../engine/state";
import { step } from "../engine/step";
import { systemText } from "../engine/turn";
import type { InterpretRequest, Interpreter } from "../nlu/interpreter";
import { withDeadline } from "./deadline";

export interface SafeInterpretation {
  /** null: unavailable, whatever the reason; the engine still answers (D32). */
  readonly interpretation: Interpretation | null;
  readonly problem: "timeout" | "error" | null;
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

/** D107: a slow or broken interpreter is an unavailable NLU, never a silent turn. */
export async function interpretSafely(
  interpreter: Interpreter,
  request: InterpretRequest,
  deadlineMs: number,
  logger: Logger,
): Promise<SafeInterpretation> {
  try {
    // The wrapper turns a synchronous throw into a rejection.
    const result = await withDeadline(
      Promise.resolve().then(() => interpreter.interpret(request)),
      deadlineMs,
    );
    if (result.timedOut) {
      logger.warn({ turnId: request.turnId, deadlineMs }, "nlu deadline exceeded");
      return { interpretation: null, problem: "timeout" };
    }
    return { interpretation: result.value, problem: null };
  } catch (error: unknown) {
    logger.warn({ turnId: request.turnId, error: errorName(error) }, "nlu failed");
    return { interpretation: null, problem: "error" };
  }
}

export interface SafeStep {
  readonly state: SessionState;
  readonly effects: readonly Effect[];
  /** step() threw something that is not an EngineError: the state is unchanged. */
  readonly crashed: boolean;
}

/** The reply and the flag of a turn the engine could not run. */
export function crashEffects(): Effect[] {
  return [
    { type: "SendText", text: systemText("system.generic_error") },
    { type: "FlagSession", reason: "incoherent_state", needsAttention: true },
  ];
}

/** D107: step() rethrows what is not an EngineError; the runtime answers and flags instead. */
export function stepSafely(
  state: SessionState,
  event: EngineEvent,
  campaign: CampaignDefinition,
  logger: Logger,
): SafeStep {
  try {
    return { ...step(state, event, campaign), crashed: false };
  } catch (error: unknown) {
    logger.error({ error: errorName(error) }, "engine threw");
    return { state, effects: crashEffects(), crashed: true };
  }
}
