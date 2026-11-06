import type { Interpretation } from "./interpretation";

/** Spec §7.1. `at` is an ISO-8601 timestamp: the engine never reads the clock. */
export type EngineEvent =
  | { readonly type: "session_started"; readonly at: string }
  | {
      readonly type: "user_turn";
      readonly at: string;
      /**
       * The burst's text, used only for deterministic checks (global keywords, language
       * names). Never logged.
       */
      readonly text: string;
      /** null when nlu is unavailable: the engine still handles the global keywords. */
      readonly interpretation: Interpretation | null;
    }
  | { readonly type: "timeout"; readonly at: string }
  | { readonly type: "outbound_failed"; readonly at: string };

export type UserTurnEvent = Extract<EngineEvent, { type: "user_turn" }>;
