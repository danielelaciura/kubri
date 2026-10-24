import type { UserTurnEvent } from "./events";
import { nonAnswer } from "./replies";
import type { Turn } from "./turn";

/** A user turn while the flow waits on a step (spec §7.2). */
export function handleFlowTurn(turn: Turn, event: UserTurnEvent): void {
  nonAnswer(turn, event.interpretation);
}
