import type { CampaignDefinition } from "../../../src/campaigns/schema/campaign";
import { describeEffect } from "../../../src/engine/describe";
import type { Effect } from "../../../src/engine/effects";
import type { EngineEvent } from "../../../src/engine/events";
import { fieldState } from "../../../src/engine/profile-snapshot";
import { initialSessionState, type SessionState } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import { describeTextRef } from "../../../src/engine/text-ref";
import type { Expectation, Scenario } from "./scenario";

export interface TurnReport {
  readonly label: string;
  readonly expected: Expectation;
  /** Only the keys present in `expected`. */
  readonly actual: Partial<Record<keyof Expectation, unknown>>;
  /** Spec §7.2 point 9: a user turn must end with a text or a flag. */
  readonly silent: boolean;
}

const START = Date.UTC(2026, 9, 24, 10, 0, 0);

export function runScenario(scenario: Scenario, campaign: CampaignDefinition): TurnReport[] {
  let state = initialSessionState();
  return scenario.turns.map((turn, i) => {
    // Deterministic clock: one minute per turn.
    const at = new Date(START + i * 60_000).toISOString();
    const event: EngineEvent =
      "start" in turn
        ? { type: "session_started", at }
        : { type: "user_turn", at, text: turn.user, interpretation: turn.nlu ?? null };
    const result = step(state, event, campaign);
    state = result.state;
    return {
      label: `turn ${i + 1} (${"start" in turn ? "start" : JSON.stringify(turn.user)})`,
      expected: turn.expect,
      actual: observe(state, result.effects, turn.expect),
      silent: !result.effects.some((e) => e.type === "SendText" || e.type === "FlagSession"),
    };
  });
}

function observe(
  state: SessionState,
  effects: readonly Effect[],
  expected: Expectation,
): Partial<Record<keyof Expectation, unknown>> {
  const all: Record<keyof Expectation, unknown> = {
    phase: state.phase,
    step: state.stepId,
    question: state.questionId,
    consentsAccepted: state.consentsAccepted,
    sent: effects.flatMap((e) => (e.type === "SendText" ? [describeTextRef(e.text)] : [])),
    effects: effects.filter((e) => e.type !== "SendText").map(describeEffect),
    profile: Object.fromEntries(
      Object.keys(expected.profile ?? {}).map((field) => [
        field,
        fieldState(state.profile, field)?.value,
      ]),
    ),
    outcomes: Object.fromEntries(
      Object.keys(expected.outcomes ?? {}).map((id) => [id, state.outcomes[id]]),
    ),
  };
  return Object.fromEntries(
    Object.keys(expected).map((key) => [key, all[key as keyof Expectation]]),
  );
}
