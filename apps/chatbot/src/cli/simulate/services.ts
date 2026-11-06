import { FakeTranslator } from "../../i18n/fake-translator";
import type { Translator } from "../../i18n/translator";
import { REAL_TIMING } from "../../nlu/call-policy";
import { createLlmInterpreter } from "../../nlu/interpret";
import type { Interpreter } from "../../nlu/interpreter";
import type { LlmTaskOptions } from "../../nlu/llm-task";
import type { NluServices } from "../../nlu/services";
import { NOOP_TRACE_SINK, type NluTraceSink } from "../../nlu/trace";
import { createLlmTranslator } from "../../nlu/translate";
import { CliError, type CliDeps } from "../deps";
import { naiveInterpreter } from "./naive-interpreter";

export const INTERPRETER_KINDS = ["naive", "llm"] as const;
export type InterpreterKind = (typeof INTERPRETER_KINDS)[number];
export const TRANSLATOR_KINDS = ["fake", "llm"] as const;
export type TranslatorKind = (typeof TRANSLATOR_KINDS)[number];

export interface SimulationKinds {
  readonly nlu: InterpreterKind;
  readonly translator: TranslatorKind;
}

export interface SimulationServices {
  readonly interpreter: Interpreter;
  readonly translator: Translator;
}

export interface SimulationNluSettings {
  readonly traces?: NluTraceSink;
  /** `--history`: in the simulator it wins over NLU_HISTORY_MESSAGES. */
  readonly historyMessages?: number;
}

function interpreterFor(kind: InterpreterKind, llm: () => LlmTaskOptions): Interpreter {
  switch (kind) {
    case "naive":
      return naiveInterpreter;
    case "llm":
      return createLlmInterpreter(llm());
  }
}

function translatorFor(kind: TranslatorKind, llm: () => LlmTaskOptions): Translator {
  switch (kind) {
    case "fake":
      return new FakeTranslator();
    case "llm":
      return createLlmTranslator(llm());
  }
}

export function createSimulationServices(
  kinds: SimulationKinds,
  deps: CliDeps,
  settings: SimulationNluSettings = {},
): SimulationServices {
  let options: LlmTaskOptions | undefined;
  // Built at most once, and only for an llm kind: a missing key fails before the interview.
  const llm = (): LlmTaskOptions => {
    if (options) return options;
    let services: NluServices;
    try {
      services = deps.nlu();
    } catch (error: unknown) {
      throw new CliError(error instanceof Error ? error.message : String(error));
    }
    const { historyMessages } = settings;
    options = {
      provider: services.provider,
      config:
        historyMessages === undefined ? services.config : { ...services.config, historyMessages },
      traces: settings.traces ?? NOOP_TRACE_SINK,
      timing: REAL_TIMING,
      now: deps.now,
    };
    return options;
  };
  return {
    interpreter: interpreterFor(kinds.nlu, llm),
    translator: translatorFor(kinds.translator, llm),
  };
}
