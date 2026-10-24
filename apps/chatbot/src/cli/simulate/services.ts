import { FakeTranslator } from "../../i18n/fake-translator";
import type { Translator } from "../../i18n/translator";
import type { Interpreter } from "../../nlu/interpreter";
import type { CliDeps } from "../deps";
import { naiveInterpreter } from "./naive-interpreter";

// Plan 06 adds "llm" to both lists, and one factory to each map below.
export const INTERPRETER_KINDS = ["naive"] as const;
export type InterpreterKind = (typeof INTERPRETER_KINDS)[number];
export const TRANSLATOR_KINDS = ["fake"] as const;
export type TranslatorKind = (typeof TRANSLATOR_KINDS)[number];

export interface SimulationKinds {
  readonly nlu: InterpreterKind;
  readonly translator: TranslatorKind;
}

export interface SimulationServices {
  readonly interpreter: Interpreter;
  readonly translator: Translator;
}

// One factory per kind: a Record keeps the lists exhaustive (a single-case switch fails lint).
const INTERPRETERS: Readonly<Record<InterpreterKind, (deps: CliDeps) => Interpreter>> = {
  naive: () => naiveInterpreter,
};

const TRANSLATORS: Readonly<Record<TranslatorKind, (deps: CliDeps) => Translator>> = {
  fake: () => new FakeTranslator(),
};

export function createSimulationServices(
  kinds: SimulationKinds,
  deps: CliDeps,
): SimulationServices {
  return {
    interpreter: INTERPRETERS[kinds.nlu](deps),
    translator: TRANSLATORS[kinds.translator](deps),
  };
}
