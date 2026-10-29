import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { Interpretation } from "../engine/interpretation";
import type { SessionState } from "../engine/state";

/** One user turn to interpret (spec §8.1 point 1). */
export interface InterpretRequest {
  /** The burst's text. */
  readonly text: string;
  /** Read only: nlu builds the context from it (spec §8.2) and never writes state. */
  readonly state: SessionState;
  readonly campaign: CampaignDefinition;
  /** Earlier user messages of the session, oldest first, without the current one. */
  readonly history: readonly string[];
  /** For NluTrace (plan 06); null in the simulator, set by runtime (plan 08). */
  readonly turnId: string | null;
}

/**
 * Implemented by the simulator (naive) and by the LLM (plan 06). null = nlu unavailable: the
 * engine still applies the global keywords (D32).
 */
export interface Interpreter {
  interpret(request: InterpretRequest): Promise<Interpretation | null>;
}
