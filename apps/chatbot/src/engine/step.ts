import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { Effect } from "./effects";
import type { EngineEvent, UserTurnEvent } from "./events";
import { handleFlowTurn } from "./flow-turn";
import { handleLanguageTurn } from "./language-phase";
import { handlePostCompletionTurn } from "./post-completion";
import type { SessionState } from "./state";
import { EngineError, createTurn, emit, incoherent, say, systemText, type Turn } from "./turn";

export interface StepResult {
  readonly state: SessionState;
  readonly effects: readonly Effect[];
}

/**
 * The engine (spec §7): pure and deterministic. Time comes from the event; `campaign` is the
 * parsed definition of the version the session is pinned to.
 */
export function step(
  state: SessionState,
  event: EngineEvent,
  campaign: CampaignDefinition,
): StepResult {
  const turn = createTurn(state, campaign, event.at);
  try {
    dispatch(turn, event);
  } catch (error) {
    if (!(error instanceof EngineError)) throw error;
    // Never silent (spec §7.2 point 9): the state stays as it was and the session needs attention.
    return {
      state,
      effects: [
        { type: "SendText", text: systemText("system.generic_error") },
        { type: "FlagSession", reason: error.reason, needsAttention: true },
      ],
    };
  }
  return { state: turn.state, effects: turn.effects };
}

function dispatch(turn: Turn, event: EngineEvent): void {
  switch (event.type) {
    case "session_started":
      if (turn.state.phase !== "language") {
        incoherent(`session_started in phase ${turn.state.phase}`);
      }
      say(turn, systemText("system.welcome"));
      return;
    case "user_turn":
      handleUserTurn(turn, event);
      return;
    case "timeout":
      // Follow-up of abandoned sessions is out of v1 scope (spec §17, D45).
      return;
    case "outbound_failed":
      emit(turn, { type: "FlagSession", reason: "outbound_failed", needsAttention: true });
      return;
  }
}

function handleUserTurn(turn: Turn, event: UserTurnEvent): void {
  switch (turn.state.phase) {
    case "closed":
      say(turn, systemText("system.session_closed"));
      return;
    case "language":
      handleLanguageTurn(turn, event);
      return;
    case "flow":
      handleFlowTurn(turn, event);
      return;
    case "post_completion":
      handlePostCompletionTurn(turn, event);
      return;
  }
}
