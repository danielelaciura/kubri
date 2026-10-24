import type { UserTurnEvent } from "./events";
import type { TextRef } from "./text-ref";
import { say, systemText, type Turn } from "./turn";

/** Spec §5.7: messages after the interview is completed. */
export function handlePostCompletionTurn(turn: Turn, _event: UserTurnEvent): void {
  say(turn, postCompletionHelp(turn));
}

export function postCompletionHelp(turn: Turn): TextRef {
  const { allowEdits, allowCvRegeneration } = turn.campaign.afterCompletion;
  return systemText("system.post_completion_help", { allowEdits, allowCvRegeneration });
}
