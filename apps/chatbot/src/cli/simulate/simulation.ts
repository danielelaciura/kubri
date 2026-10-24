import type { CampaignDefinition } from "../../campaigns/schema/campaign";
import { describeEffect } from "../../engine/describe";
import type { Effect } from "../../engine/effects";
import type { EngineEvent } from "../../engine/events";
import type { Interpretation } from "../../engine/interpretation";
import { initialSessionState, type SessionState } from "../../engine/state";
import { step } from "../../engine/step";
import {
  outputLanguage,
  type ResolvedText,
  type TextResolver,
  type TextSource,
} from "../../i18n/resolve";
import type { Interpreter } from "../../nlu/interpreter";
import { parseInput, USAGE } from "./commands";

export interface SimulationOptions {
  readonly campaign: CampaignDefinition;
  readonly interpreter: Interpreter;
  readonly resolver: TextResolver;
  /** ISO-8601: the engine never reads the clock. */
  readonly now: () => string;
  /** Earlier user messages passed to the interpreter (spec §8.2). */
  readonly historySize: number;
}

export interface Simulation {
  readonly state: SessionState;
  start(): Promise<string[]>;
  /** The lines to print; null when the operator asked to quit. */
  handle(line: string): Promise<string[] | null>;
}

const TAGGED_SOURCES: ReadonlySet<TextSource> = new Set([
  "cache",
  "translated",
  "fallback",
  "generated",
]);

/** "bot> text", with the source when the text was not written by a person. */
export function formatBotText(resolved: ResolvedText): string[] {
  const label = TAGGED_SOURCES.has(resolved.source) ? `bot[${resolved.source}]> ` : "bot> ";
  const [first = "", ...rest] = resolved.text.split("\n");
  return [`${label}${first}`, ...rest.map((line) => `${" ".repeat(label.length)}${line}`)];
}

export function describeState(state: SessionState): string[] {
  const lines = [
    [
      `phase=${state.phase}`,
      `step=${state.stepId ?? "-"}`,
      `question=${state.questionId ?? "-"}`,
      `language=${state.language ?? "-"}`,
      `consentsAccepted=${String(state.consentsAccepted)}`,
      `clarifications=${state.clarifications}`,
      `pending=${state.pendingConfirmation?.kind ?? "none"}`,
    ].join(" "),
  ];
  for (const [field, s] of Object.entries(state.profile)) {
    lines.push(`  ${field} = ${JSON.stringify(s.value)} (${s.status}, ${s.confidence})`);
  }
  return lines;
}

export function createSimulation(options: SimulationOptions): Simulation {
  const { campaign } = options;
  let state = initialSessionState();
  const history: string[] = [];

  async function render(effects: readonly Effect[]): Promise<string[]> {
    // D77: after step(), so a turn that sets the language already speaks it.
    const target = { campaign, language: outputLanguage(state.language, campaign) };
    const lines: string[] = [];
    for (const effect of effects) {
      if (effect.type === "SendText") {
        lines.push(...formatBotText(await options.resolver.resolveSend(effect, target)));
      } else {
        lines.push(`  · ${describeEffect(effect)}`);
      }
    }
    return lines;
  }

  async function run(event: EngineEvent): Promise<string[]> {
    const result = step(state, event, campaign);
    state = result.state;
    return render(result.effects);
  }

  async function interpret(text: string): Promise<[Interpretation | null, string[]]> {
    try {
      const interpretation = await options.interpreter.interpret({
        text,
        state,
        campaign,
        history: history.slice(-options.historySize),
        turnId: null,
      });
      return [interpretation, []];
    } catch (error: unknown) {
      // Like runtime: a failing nlu is an unavailable nlu (D32), the engine still answers.
      const message = error instanceof Error ? error.message : String(error);
      return [null, [`! interpreter failed: ${message}`]];
    }
  }

  return {
    get state() {
      return state;
    },
    start: () => run({ type: "session_started", at: options.now() }),
    async handle(line) {
      const input = parseInput(line, state, campaign);
      switch (input.kind) {
        case "quit":
          return null;
        case "usage":
          return [...USAGE];
        case "state":
          return describeState(state);
        case "invalid":
          return [`! ${input.message}`];
        case "forced":
          return run({
            type: "user_turn",
            at: options.now(),
            text: input.text,
            interpretation: input.interpretation,
          });
        case "text": {
          const [interpretation, notes] = await interpret(input.text);
          history.push(input.text);
          const lines = await run({
            type: "user_turn",
            at: options.now(),
            text: input.text,
            interpretation,
          });
          return [...notes, ...lines];
        }
      }
    },
  };
}
