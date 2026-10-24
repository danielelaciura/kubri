import { enterStep } from "./advance";
import type { UserTurnEvent } from "./events";
import { chooseLanguage } from "./language";
import { emit, setState, type Turn } from "./turn";

/** The fixed system step before the flow (spec §5.6, D41). */
export function handleLanguageTurn(turn: Turn, event: UserTurnEvent): void {
  const language = chooseLanguage(event.text, event.interpretation, turn.campaign.defaultLanguage);
  emit(turn, { type: "SetLanguage", language });
  setState(turn, { phase: "flow", language });
  enterStep(turn, 0);
}
